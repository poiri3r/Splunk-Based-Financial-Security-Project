package com.club.bank;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import jakarta.persistence.criteria.Predicate;
import java.time.*;
import java.util.*;
import java.math.BigDecimal;

@Service
class AccountQueryService {
    private final org.springframework.security.crypto.password.PasswordEncoder passwords;private final CredentialPolicy credentials;
    private final CurrentCustomer current;private final UserRepo users;private final AccountRepo accounts;
    private final LedgerRepo ledger;private final IdempotencyRepo keys;private final FieldCrypto crypto;
    private final BankService bank;private final TransactionCursor cursors;private final AccountManagementService management;
    AccountQueryService(CurrentCustomer current,UserRepo users,AccountRepo accounts,LedgerRepo ledger,IdempotencyRepo keys,
        FieldCrypto crypto,BankService bank,TransactionCursor cursors,AccountManagementService management,org.springframework.security.crypto.password.PasswordEncoder passwords,CredentialPolicy credentials) {
        this.passwords=passwords;this.credentials=credentials;
        this.management=management;
        this.current=current;this.users=users;this.accounts=accounts;this.ledger=ledger;this.keys=keys;
        this.crypto=crypto;this.bank=bank;this.cursors=cursors;
    }
    @Transactional(readOnly=true) public AccountList list(boolean includeHidden) {
        return new AccountList(accounts.findByOwnerIdOrderById(current.id()).stream().filter(a->includeHidden||!a.hidden).sorted(Comparator.comparingInt((Account a)->a.displayOrder).thenComparing(a->a.id)).map(this::view).toList());
    }
    @Transactional(readOnly=true) public AccountDetail detail(UUID id){return view(owned(id));}
    private Account owned(UUID id) {
        return accounts.findByPublicIdAndOwnerId(id.toString(),current.id()).orElseThrow(()->
            new ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","계좌가 없거나 접근할 수 없습니다."));
    }
    private AccountDetail view(Account a) {
        return new AccountDetail(a.publicId,a.number(crypto),a.accountName,a.accountType,a.currency,a.status,
            money(a.balance),"ACTIVE".equals(a.status)&&a.debitEnabled&&a.pinHash!=null&&!AccountPolicy.pinLocked(a)?money(a.balance):"0.00",a.openedAt,management.view(a));
    }
    private String money(BigDecimal v){return v==null?null:v.setScale(2).toPlainString();}
    @Transactional public OpenedAccount open(String key,OpenAccountRequest request) {
        try {if(key==null || !UUID.fromString(key).toString().equals(key))throw new IllegalArgumentException();}
        catch(IllegalArgumentException e){throw new ApiException(HttpStatus.BAD_REQUEST,"IDEMPOTENCY_KEY_INVALID","소문자 표준 UUID 키가 필요합니다.");}
        BankUser u=current.locked();
        CredentialPolicy.banking(u);
        if(!"MOCK-CHECKING-2026-v1".equals(request.termsVersion()))throw new ApiException(HttpStatus.CONFLICT,"TERMS_VERSION_REQUIRED","입출금통장 약관을 확인해 주세요.");
        credentials.pin(request.pin(),u);
        String hash=crypto.lookup("idempotency.open-account",request.pin()+"|"+request.termsVersion());
        var old=keys.findByUserIdAndRequestKey(u.id,key).orElse(null);
        Account a;
        if(old!=null) {
            if(!"OPEN_ACCOUNT".equals(old.operation)||!hash.equals(old.requestHash))throw new ApiException(HttpStatus.CONFLICT,"IDEMPOTENCY_KEY_CONFLICT","같은 키가 다른 요청에 사용되었습니다.");
            a=owned(UUID.fromString(old.resultId));
        }else {
            AccountView opened=bank.openAccount();
            a=accounts.findByNumberLookup(crypto.lookup("accounts.number",opened.number())).orElseThrow();
            a.pinHash=passwords.encode(request.pin());a.openingTermsVersion=request.termsVersion();a.openingTermsAcceptedAt=IdentityService.now();
            keys.save(new IdempotencyRecord(u,key,hash,"OPEN_ACCOUNT",a.publicId));
        }
        // Opening-result balance is always the original zero, even after later deposits.
        return new OpenedAccount(a.publicId,a.number(crypto),"0.00",a.openedAt);
    }
    @Transactional(readOnly=true) public TransactionPage history(UUID accountId,LocalDate fromInput,LocalDate toInput,
        TransactionType type,int size,String cursor) {
        Account a=owned(accountId);
        LocalDate to=toInput==null?LocalDate.now(ZoneId.of("Asia/Seoul")):toInput;
        if(to.getYear()<1900||to.getYear()>9998)throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","지원하는 날짜 범위는 1900~9998년입니다.","to");
        LocalDate from=fromInput==null?to.minusMonths(1):fromInput;
        if(from.getYear()<1900||to.getYear()>9998||from.getYear()>9998||to.getYear()<1900||from.isAfter(to)||to.isAfter(from.plusYears(1)))throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","시작일과 종료일은 최대 1년 범위로 입력해 주세요.","from");
        if(size<1||size>100)throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","size는 1~100이어야 합니다.","size");
        Instant start,end;
        try {start=from.atStartOfDay(ZoneId.of("Asia/Seoul")).toInstant();end=to.plusDays(1).atStartOfDay(ZoneId.of("Asia/Seoul")).toInstant();}
        catch(DateTimeException e){throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","날짜 범위를 확인해 주세요.");}
        var pos=cursor==null?null:cursors.decode(cursor,a.publicId,from.toString(),to.toString(),type.name());
        long maximum=pos==null?ledger.maxId(a.id):pos.maximumId();
        Specification<LedgerEntry> spec=(root,query,cb)->{
            var predicates=new ArrayList<Predicate>();
            predicates.add(cb.equal(root.get("account").get("id"),a.id));
            predicates.add(cb.greaterThanOrEqualTo(root.<Instant>get("createdAt"),start));
            predicates.add(cb.lessThan(root.<Instant>get("createdAt"),end));
            predicates.add(cb.lessThanOrEqualTo(root.<Long>get("id"),maximum));
            if(type==TransactionType.DEPOSIT)predicates.add(cb.greaterThan(root.get("amount"),BigDecimal.ZERO));
            if(type==TransactionType.WITHDRAWAL)predicates.add(cb.lessThan(root.get("amount"),BigDecimal.ZERO));
            if(pos!=null)predicates.add(cb.or(cb.lessThan(root.<Instant>get("createdAt"),pos.time()),
                cb.and(cb.equal(root.get("createdAt"),pos.time()),cb.lessThan(root.<Long>get("id"),pos.id()))));
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        var found=ledger.findAll(spec,PageRequest.of(0,size+1,Sort.by(Sort.Direction.DESC,"createdAt","id"))).getContent();
        boolean hasNext=found.size()>size;
        var page=found.subList(0,Math.min(size,found.size()));
        String next=null;
        if(hasNext) {
            LedgerEntry last=page.get(page.size()-1);
            next=cursors.encode(new TransactionCursor.Position(a.publicId,from.toString(),to.toString(),type.name(),maximum,last.createdAt,last.id));
        }
        var items=page.stream().map(e->new TransactionDetail(e.publicId,e.transferId,e.counterparty(crypto),money(e.amount),
            e.amount.signum()>0?"DEPOSIT":"WITHDRAWAL",money(e.balanceAfter),e.createdAt)).toList();
        return new TransactionPage(items,next,hasNext,from,to);
    }
}
