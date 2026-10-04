package com.club.bank;
import java.time.*;
import java.math.BigDecimal;
import org.springframework.stereotype.Component;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.http.HttpStatus;

/** Caller holds user then account locks. A PinFailure must commit only the failure counter. */
@Component
class AccountPolicy {
    private final PasswordEncoder passwords;private final LimitUsageRepo usages;
    AccountPolicy(PasswordEncoder passwords,LimitUsageRepo usages){this.passwords=passwords;this.usages=usages;}
    static LocalDate today(){return LocalDate.now(ZoneId.of("Asia/Seoul"));}
    static boolean pinLocked(Account a){return a.pinFailures>=4;}
    static void debit(Account a){
        if(a.pinHash==null)throw new ApiException(HttpStatus.FORBIDDEN,"ACCOUNT_PIN_REQUIRED","계좌 비밀번호를 먼저 등록해 주세요.");
        if(!a.debitEnabled)throw new ApiException(HttpStatus.CONFLICT,"DEBIT_DISABLED","출금 등록이 해제된 계좌입니다.");
        if(pinLocked(a))throw new ApiException(HttpStatus.LOCKED,"PIN_LOCKED","계좌 비밀번호가 잠겨 있습니다.");
    }
    void verifyPin(Account a,String pin){
        if(pinLocked(a))throw new PinFailure(HttpStatus.LOCKED,"PIN_LOCKED","계좌 비밀번호가 잠겨 있습니다.");
        if(a.pinHash==null)throw new ApiException(HttpStatus.FORBIDDEN,"ACCOUNT_PIN_REQUIRED","계좌 비밀번호를 먼저 등록해 주세요.");
        if(pin==null)throw new ApiException(HttpStatus.FORBIDDEN,"ACCOUNT_PIN_REQUIRED","계좌 비밀번호가 필요합니다.");
        
        if(!passwords.matches(pin,a.pinHash)){
            a.pinFailures++;
            if(a.pinFailures>=4){a.pinLockedUntil=null;a.securityVersion++;}
            throw new PinFailure(a.pinFailures>=4?HttpStatus.LOCKED:HttpStatus.FORBIDDEN,
                a.pinFailures>=4?"PIN_LOCKED":"PIN_INVALID",a.pinFailures>=4?"계좌 비밀번호가 잠겼습니다. 본인확인 후 재설정해 주세요.":"계좌 비밀번호가 올바르지 않습니다.");
        }
        a.pinFailures=0;a.pinLockedUntil=null;
    }
    BigDecimal used(Long user){return used(user,today());}
    BigDecimal used(Long user,LocalDate day){return usages.findById(user+":"+day).map(x->x.amount).orElse(BigDecimal.ZERO.setScale(2));}
    void checkLimits(BankUser user,BigDecimal amount){checkLimits(user,amount,today());}
    private void checkLimits(BankUser user,BigDecimal amount,LocalDate day){
        if(user.perTransferLimit!=null && amount.compareTo(user.perTransferLimit)>0)
            throw new ApiException(HttpStatus.CONFLICT,"PER_TRANSFER_LIMIT_EXCEEDED","1회 이체한도를 초과합니다.");
        if(user.dailyLimit!=null && used(user.id,day).add(amount).compareTo(user.dailyLimit)>0)
            throw new ApiException(HttpStatus.CONFLICT,"DAILY_LIMIT_EXCEEDED","오늘의 이체한도를 초과합니다.");
    }
    void consume(BankUser user,BigDecimal amount){
        LocalDate day=today();checkLimits(user,amount,day);String id=user.id+":"+day;
        LimitUsage u=usages.findById(id).orElseGet(()->new LimitUsage(id,user.id,day));
        u.amount=u.amount.add(amount);usages.save(u);
    }
}
/** Only thrown before any balance, setting, or grant mutation in designated noRollbackFor entry points. */
class PinFailure extends ApiException {
    PinFailure(HttpStatus status,String code,String message){super(status,code,message);}
}
