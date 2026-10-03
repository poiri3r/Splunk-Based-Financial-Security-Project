package com.club.bank;
import java.math.BigDecimal;
import java.util.UUID;
import jakarta.persistence.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import org.springframework.http.HttpStatus;

/** Both API versions use this atomic balance/ledger operation inside their caller's transaction. */
@Service
class TransferEngine {
    static final BigDecimal MAX_BALANCE=new BigDecimal("99999999999999999.99");
    private final AccountRepo accounts; private final LedgerRepo ledger;
    private final EntityManager em; private final FieldCrypto crypto;
    private final CurrentCustomer current;private final UserRepo users;private final AccountPolicy policy;
    TransferEngine(AccountRepo accounts,LedgerRepo ledger,EntityManager em,FieldCrypto crypto,UserRepo users,AccountPolicy policy,CurrentCustomer current) {
        this.current=current;
        this.users=users;this.policy=policy;
        this.accounts=accounts;this.ledger=ledger;this.em=em;this.crypto=crypto;
    }
    record Posting(String id,BigDecimal sourceBalance,BigDecimal targetBalance) {}
    static void check(Account from,Account to,Long owner,BigDecimal amount) {
        SavingsService.checking(from);SavingsService.checking(to);
        if(!from.owner.getId().equals(owner)) throw new ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","출금 계좌가 없거나 접근할 수 없습니다.");
        if(from.id.equals(to.id)) throw new ApiException(HttpStatus.BAD_REQUEST,"SAME_ACCOUNT","출금 계좌와 입금 계좌가 같습니다.");
        if(amount==null || amount.signum()<=0 || amount.scale()>2 || amount.compareTo(MAX_BALANCE)>0)
            throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","금액 범위를 확인해 주세요.","amount");
        if(!"ACTIVE".equals(from.status)||!"ACTIVE".equals(to.status)) throw new ApiException(HttpStatus.CONFLICT,"ACCOUNT_UNAVAILABLE","거래할 수 없는 계좌입니다.");
        if(!"KRW".equals(from.currency)||!"KRW".equals(to.currency)) throw new ApiException(HttpStatus.CONFLICT,"CURRENCY_NOT_SUPPORTED","KRW 계좌만 지원합니다.");
        if(from.balance.compareTo(amount)<0) throw new ApiException(HttpStatus.CONFLICT,"INSUFFICIENT_BALANCE","잔액이 부족합니다.");
        if(to.balance.add(amount).compareTo(MAX_BALANCE)>0) throw new ApiException(HttpStatus.CONFLICT,"BALANCE_LIMIT_EXCEEDED","입금 계좌의 잔액 상한을 초과합니다.");
    }
    @Transactional(propagation=Propagation.MANDATORY)
    public Posting post(Long owner,Account source,Account target,BigDecimal amount) {return post(owner,source,target,amount,null);}
    @Transactional(propagation=Propagation.MANDATORY)
    public Posting post(Long owner,Account source,Account target,BigDecimal amount,Long verifiedSecurityVersion) {
        // All current/future callers share user -> ascending account lock order.
        BankUser user=users.findLockedById(owner).orElseThrow();em.refresh(user,LockModeType.PESSIMISTIC_WRITE);current.requireFresh(user);
        if(source.id.equals(target.id)) throw new ApiException(HttpStatus.BAD_REQUEST,"SAME_ACCOUNT","출금 계좌와 입금 계좌가 같습니다.");
        Account first=accounts.findLockedById(Math.min(source.id,target.id)).orElseThrow();
        Account second=accounts.findLockedById(Math.max(source.id,target.id)).orElseThrow();
        em.refresh(first,LockModeType.PESSIMISTIC_WRITE); em.refresh(second,LockModeType.PESSIMISTIC_WRITE);
        Account from=first.id.equals(source.id)?first:second,to=first.id.equals(target.id)?first:second;
        CredentialPolicy.banking(user);check(from,to,owner,amount);AccountPolicy.debit(from);
        if(verifiedSecurityVersion!=null && verifiedSecurityVersion!=from.securityVersion)
            throw new ApiException(HttpStatus.FORBIDDEN,"ACTION_TOKEN_INVALID","계좌 보안 설정이 변경되었습니다. 다시 인증해 주세요.");
        if(from.pinHash!=null && verifiedSecurityVersion==null)
            throw new ApiException(HttpStatus.FORBIDDEN,"ACCOUNT_PIN_REQUIRED","계좌 비밀번호 확인이 가능한 v2 이체를 사용해 주세요.");
        policy.consume(user,amount);
        from.balance=from.balance.subtract(amount);to.balance=to.balance.add(amount);
        String id=UUID.randomUUID().toString();
        ledger.save(new LedgerEntry(from,to.number(crypto),amount.negate(),id,crypto));
        ledger.save(new LedgerEntry(to,from.number(crypto),amount,id,crypto));
        return new Posting(id,from.balance,to.balance);
    }
}
