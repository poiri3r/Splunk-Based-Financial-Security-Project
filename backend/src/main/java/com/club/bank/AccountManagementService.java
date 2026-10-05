package com.club.bank;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import jakarta.persistence.*;
import jakarta.validation.Validator;
import com.fasterxml.jackson.databind.*;
import java.util.*;
import java.math.BigDecimal;
import java.time.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

@Service
class AccountManagementService {
    private final CredentialPolicy credentials;
    private final CurrentCustomer current;private final UserRepo users;private final AccountRepo accounts;
    private final SettingActionRepo grants;private final FieldCrypto crypto;private final PasswordEncoder passwords;
    private final EntityManager em;private final ObjectMapper json;private final Validator validator;
    private final StepUpLimiter stepUpLimiter;
    private final TransferRequestLimiter limiter;private final AccountPolicy policy;
    private static final SecureRandom RANDOM=new SecureRandom();
    AccountManagementService(CurrentCustomer current,UserRepo users,AccountRepo accounts,SettingActionRepo grants,
        FieldCrypto crypto,PasswordEncoder passwords,EntityManager em,ObjectMapper json,Validator validator,
        TransferRequestLimiter limiter,AccountPolicy policy,CredentialPolicy credentials,StepUpLimiter stepUpLimiter){
        this.credentials=credentials;this.stepUpLimiter=stepUpLimiter;
        this.current=current;this.users=users;this.accounts=accounts;this.grants=grants;this.crypto=crypto;
        this.passwords=passwords;this.em=em;this.json=json;this.validator=validator;this.limiter=limiter;this.policy=policy;
    }
    private BankUser user(){BankUser u=users.findLockedById(current.id()).orElseThrow();em.refresh(u,LockModeType.PESSIMISTIC_WRITE);current.requireFresh(u);return u;}
    private Account owned(UUID id){return accounts.findByPublicIdAndOwnerId(id.toString(),current.id()).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","계좌가 없거나 접근할 수 없습니다."));}
    private Account locked(UUID id){Account a=owned(id);accounts.findLockedById(a.id).orElseThrow();em.refresh(a,LockModeType.PESSIMISTIC_WRITE);return a;}
    static ApiException invalid(){return new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","변경값과 버전을 확인해 주세요.");}
    static void version(long actual,Long expected){if(expected==null||actual!=expected)throw new ApiException(HttpStatus.CONFLICT,"VERSION_CONFLICT","정보가 변경되었습니다. 다시 조회해 주세요.");}
    static String alias(String s){if(s==null)return null;s=s.strip();if(s.isEmpty()||s.length()>50||s.codePoints().anyMatch(Character::isISOControl))throw invalid();return s;}
    private static String money(BigDecimal n){return n==null?null:n.setScale(2).toPlainString();}
    AccountSettings view(Account a){return new AccountSettings(a.publicId,a.aliasEncrypted==null?null:crypto.decrypt("accounts.alias",a.publicId,a.aliasEncrypted),
        a.hidden,a.displayOrder,a.debitEnabled,a.pinHash!=null,AccountPolicy.pinLocked(a),AccountPolicy.pinLocked(a)?a.pinLockedUntil:null,a.settingsVersion);}
    @Transactional(readOnly=true) public AccountSettings settings(UUID id){return view(owned(id));}
    @Transactional public AccountSettings preferences(UUID id,JsonNode r){
        user();Account a=locked(id);fields(r,Set.of("version","alias","hidden","order"));
        Long v=versionField(r);version(a.settingsVersion,v);
        if(!r.has("alias")&&!r.has("hidden")&&!r.has("order"))throw invalid();
        if(r.has("alias")){
            if(!r.get("alias").isNull()&&!r.get("alias").isTextual())throw invalid();
            String value=alias(r.get("alias").isNull()?null:r.get("alias").asText());
            a.aliasEncrypted=value==null?null:crypto.encrypt("accounts.alias",a.publicId,value);
        }
        if(r.has("hidden")){if(!r.get("hidden").isBoolean())throw invalid();a.hidden=r.get("hidden").asBoolean();}
        if(r.has("order")){if(!r.get("order").isIntegralNumber()||!r.get("order").canConvertToInt()||r.get("order").asInt()<0||r.get("order").asInt()>9999)throw invalid();a.displayOrder=r.get("order").asInt();}
        a.settingsVersion++;return view(a);
    }
    private static void fields(JsonNode node,Set<String> allowed){
        if(node==null||!node.isObject())throw invalid();var names=node.fieldNames();while(names.hasNext())if(!allowed.contains(names.next()))throw invalid();
    }
    private static Long versionField(JsonNode node){
        var v=node.get("version");if(v==null||!v.isIntegralNumber()||!v.canConvertToLong()||v.asLong()<0)throw invalid();return v.asLong();
    }
    private Object intent(StepUpRequest r){
        Set<String> allowed=switch(r.purpose()){
            case "ACCOUNT_PIN"->Set.of("version","newPin");case "DEBIT_SETTING"->Set.of("version","enabled");
            case "TRANSFER_LIMITS"->Set.of("version","perTransfer","daily");default->throw invalid();};
        fields(r.changes(),allowed);versionField(r.changes());
        try{
            Object parsed=switch(r.purpose()){
                case "ACCOUNT_PIN"->json.treeToValue(r.changes(),PinIntent.class);
                case "DEBIT_SETTING"->json.treeToValue(r.changes(),DebitIntent.class);
                default->json.treeToValue(r.changes(),LimitsIntent.class);};
            if(!validator.validate(parsed).isEmpty())throw invalid();return parsed;
        }catch(com.fasterxml.jackson.core.JsonProcessingException e){throw invalid();}
    }
    private String hash(String purpose,Object value){
        if(value instanceof LimitsIntent i)value=new LimitsIntent(i.version(),money(new BigDecimal(i.perTransfer())),money(new BigDecimal(i.daily())));
        try{return crypto.lookup("setting-intent."+purpose,json.writeValueAsString(value));}
        catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalStateException("설정 정보 처리 실패");}
    }
    private void checkLimits(BankUser u,LimitsIntent r){
        version(u.limitVersion,r.version());BigDecimal per=new BigDecimal(r.perTransfer()),daily=new BigDecimal(r.daily());
        if(per.compareTo(daily)>0)throw invalid();
        if(u.perTransferLimit!=null&&per.compareTo(u.perTransferLimit)>0||u.dailyLimit!=null&&daily.compareTo(u.dailyLimit)>0)
            throw new ApiException(HttpStatus.CONFLICT,"LIMIT_INCREASE_NOT_ALLOWED","이 화면에서는 한도 감액만 가능합니다.");
    }
    @Transactional public StepUpView authorize(StepUpRequest r){
        if(r.password()==null||r.password().isBlank())throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","로그인 비밀번호가 필요합니다.","password");
        stepUpLimiter.request(current.id());BankUser u=user();Object changes=intent(r);
        if(changes instanceof LimitsIntent i){if(!u.publicId.equals(r.targetId().toString()))throw new ApiException(HttpStatus.NOT_FOUND,"NOT_FOUND","설정 대상을 확인해 주세요.");checkLimits(u,i);}
        else {Account a=owned(r.targetId());SavingsService.checking(a);version(a.settingsVersion,changes instanceof PinIntent i?i.version():((DebitIntent)changes).version());}
        stepUpLimiter.verify(u.id,()->r.password().getBytes(StandardCharsets.UTF_8).length<=72 && passwords.matches(r.password(),u.passwordHash));
        byte[] bytes=new byte[32];RANDOM.nextBytes(bytes);String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        SettingAction g=new SettingAction();g.tokenHash=SecurityConfig.hash(token);g.userId=u.id;g.targetId=r.targetId().toString();
        g.purpose=r.purpose();g.payloadHash=hash(r.purpose(),changes);g.expiresAt=Instant.now().plusSeconds(300).truncatedTo(java.time.temporal.ChronoUnit.MICROS);grants.save(g);
        return new StepUpView(token,g.expiresAt,"PASSWORD_RECHECK");
    }
    private SettingAction grant(String token,String purpose,String target,Object changes){
        var g=grants.findById(SecurityConfig.hash(token)).orElse(null);
        if(g==null||g.consumed||!g.userId.equals(current.id())||!g.purpose.equals(purpose)||!g.targetId.equals(target)||!g.payloadHash.equals(hash(purpose,changes))||!Instant.now().isBefore(g.expiresAt))
            throw new ApiException(HttpStatus.FORBIDDEN,"ACTION_TOKEN_INVALID","변경 내용에 대한 비밀번호 재확인이 필요합니다.");
        return g;
    }
    @Transactional public AccountSettings debit(UUID id,DebitChangeRequest r){
        user();Account a=locked(id);SavingsService.checking(a);version(a.settingsVersion,r.changes().version());
        SettingAction g=grant(r.actionToken(),"DEBIT_SETTING",id.toString(),r.changes());
        a.debitEnabled=r.changes().enabled();a.settingsVersion++;a.securityVersion++;g.consumed=true;return view(a);
    }
    @Transactional(noRollbackFor=PinFailure.class) public AccountSettings pin(UUID id,PinChangeRequest r){
        BankUser u=user();Account a=locked(id);SavingsService.checking(a);version(a.settingsVersion,r.changes().version());
        SettingAction g=grant(r.actionToken(),"ACCOUNT_PIN",id.toString(),r.changes());
        // No setting/grant writes before verification: failures commit only PIN attempt state.
        credentials.pin(r.changes().newPin(),u);
        if(a.pinHash!=null)policy.verifyPin(a,r.currentPin());
        a.pinHash=passwords.encode(r.changes().newPin());a.pinFailures=0;a.pinLockedUntil=null;
        a.settingsVersion++;a.securityVersion++;g.consumed=true;return view(a);
    }
    private LimitsView limitsView(BankUser u){LocalDate day=AccountPolicy.today();BigDecimal used=policy.used(u.id,day);return new LimitsView(u.publicId,money(u.perTransferLimit),money(u.dailyLimit),money(used),
        u.dailyLimit==null?null:money(u.dailyLimit.subtract(used).max(BigDecimal.ZERO)),day,u.limitVersion);}
    @Transactional(readOnly=true) public LimitsView limits(){return limitsView(current.get());}
    @Transactional public LimitsView limits(LimitsChangeRequest r){
        BankUser u=user();checkLimits(u,r.changes());SettingAction g=grant(r.actionToken(),"TRANSFER_LIMITS",u.publicId,r.changes());
        u.perTransferLimit=new BigDecimal(r.changes().perTransfer()).setScale(2);u.dailyLimit=new BigDecimal(r.changes().daily()).setScale(2);
        u.limitVersion++;g.consumed=true;return limitsView(u);
    }
}
