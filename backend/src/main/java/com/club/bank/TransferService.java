package com.club.bank;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import jakarta.persistence.*;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.fasterxml.jackson.databind.ObjectMapper;

@Service
class TransferService {
    private final CurrentCustomer current; private final UserRepo users; private final AccountRepo accounts;
    private final TransferPreviewRepo previews; private final TransferActionRepo actions; private final TransferRecordRepo records;
    private final IdempotencyRepo keys; private final TransferEngine engine; private final FieldCrypto crypto;
    private final ObjectMapper json; private final PasswordEncoder passwords; private final EntityManager em;
    private final StepUpLimiter stepUpLimiter;
    private final TransferRequestLimiter limiter; private final TransactionCursor cursors;
    private final AccountPolicy policy;
    private static final SecureRandom RANDOM=new SecureRandom();
    TransferService(CurrentCustomer current,UserRepo users,AccountRepo accounts,TransferPreviewRepo previews,
        TransferActionRepo actions,TransferRecordRepo records,IdempotencyRepo keys,TransferEngine engine,
        FieldCrypto crypto,ObjectMapper json,PasswordEncoder passwords,EntityManager em,
        TransferRequestLimiter limiter,TransactionCursor cursors,AccountPolicy policy,StepUpLimiter stepUpLimiter) {
        this.policy=policy;this.stepUpLimiter=stepUpLimiter;
        this.current=current;this.users=users;this.accounts=accounts;this.previews=previews;this.actions=actions;
        this.records=records;this.keys=keys;this.engine=engine;this.crypto=crypto;this.json=json;
        this.passwords=passwords;this.em=em;this.limiter=limiter;this.cursors=cursors;
    }
    private static Instant now(){return Instant.now().truncatedTo(ChronoUnit.MICROS);}
    private static String money(BigDecimal n){return n.setScale(2).toPlainString();}
    private static ApiException missing(){return new ApiException(HttpStatus.NOT_FOUND,"TRANSFER_NOT_FOUND","이체 정보가 없거나 접근할 수 없습니다.");}
    private BankUser lockedUser(){
        BankUser u=users.findLockedById(current.id()).orElseThrow(TransferService::missing);
        em.refresh(u,LockModeType.PESSIMISTIC_WRITE);current.requireFresh(u);return u;
    }
    private Account target(String number){
        Account a=accounts.findByNumberLookup(crypto.lookup("accounts.number",number))
            .orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","수취 계좌를 확인해 주세요."));
        if(!"ACTIVE".equals(a.status)||!"KRW".equals(a.currency))
            throw new ApiException(HttpStatus.CONFLICT,"ACCOUNT_UNAVAILABLE","수취할 수 없는 계좌입니다.");
        return a;
    }
    private String receiverName(Account a){
        if(a.owner.getNameEncrypted()==null)return "이름 미등록";
        String name=crypto.decrypt("bank_users.name",a.owner.getPublicId(),a.owner.getNameEncrypted());
        int[] chars=name.codePoints().toArray();
        return chars.length<=1?"*":new String(chars,0,1)+"*".repeat(chars.length-1);
    }
    @Transactional(readOnly=true)
    public ReceiverView receiver(ReceiverRequest r){
        limiter.check(current.id(),"receiver",30,60);
        Account a=target(r.accountNumber());
        return new ReceiverView("LOCAL","*".repeat(r.accountNumber().length()-4)+r.accountNumber().substring(r.accountNumber().length()-4),receiverName(a),false);
    }
    @Transactional
    public PreviewView preview(PreviewRequest r){
        limiter.check(current.id(),"preview",30,60);
        BankUser u=current.get();
        Account from=accounts.findByPublicIdAndOwnerId(r.fromAccountId().toString(),u.id)
            .orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","출금 계좌가 없거나 접근할 수 없습니다."));
        Account to=target(r.toAccountNumber());BigDecimal amount=new BigDecimal(r.amount()).setScale(2);
        if(r.memo()!=null && r.memo().codePoints().anyMatch(Character::isISOControl))
            throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","메모에 제어문자를 사용할 수 없습니다.","memo");
        TransferEngine.check(from,to,u.id,amount);AccountPolicy.debit(from);policy.checkLimits(u,amount);
        TransferPreview p=new TransferPreview();p.id=UUID.randomUUID().toString();p.user=u;p.source=from;p.target=to;
        p.amount=amount;p.expiresAt=now().plusSeconds(300);
        var snapshot=new TransferSnapshot(from.publicId,from.number(crypto),"LOCAL",to.number(crypto),receiverName(to),false,r.memo());
        p.snapshotEncrypted=encrypt("transfer_previews.snapshot",p.id,snapshot);previews.save(p);
        return new PreviewView(p.id,snapshot,money(amount),"0.00","KRW",p.expiresAt);
    }
    private TransferPreview ownedPreview(UUID id,Long user){return previews.findByIdAndUserId(id.toString(),user).orElseThrow(TransferService::missing);}
    private void usable(TransferPreview p){
        if(p.resultId!=null)throw new ApiException(HttpStatus.CONFLICT,"PREVIEW_ALREADY_USED","이미 실행한 확인 건입니다.");
        if(!now().isBefore(p.expiresAt))throw new ApiException(HttpStatus.CONFLICT,"PREVIEW_EXPIRED","확인 시간이 만료되었습니다. 다시 확인해 주세요.");
    }
    @Transactional(noRollbackFor=PinFailure.class)
    public StepUpView stepUp(StepUpRequest r){
        stepUpLimiter.request(current.id());
        BankUser u=lockedUser();TransferPreview p=ownedPreview(r.targetId(),u.id);usable(p);
        stepUpLimiter.verify(u.id,()->r.password().getBytes(StandardCharsets.UTF_8).length<=72 && passwords.matches(r.password(),u.passwordHash));
        Account source=accounts.findLockedById(p.source.id).orElseThrow();em.refresh(source,LockModeType.PESSIMISTIC_WRITE);
        AccountPolicy.debit(source);
        // PIN failure is the only persisted mutation if verification fails.
        policy.verifyPin(source,r.pin());
        byte[] bytes=new byte[32];RANDOM.nextBytes(bytes);String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        TransferAction a=new TransferAction();a.tokenHash=SecurityConfig.hash(token);a.user=u;a.preview=p;
        a.expiresAt=p.expiresAt;a.accountSecurityVersion=source.securityVersion;actions.save(a);
        return new StepUpView(token,a.expiresAt,source.pinHash==null?"PASSWORD_RECHECK":"PASSWORD_AND_ACCOUNT_PIN");
    }
    private String key(String raw){
        try{if(raw==null||!UUID.fromString(raw).toString().equals(raw))throw new IllegalArgumentException();return raw;}
        catch(IllegalArgumentException e){throw new ApiException(HttpStatus.BAD_REQUEST,"IDEMPOTENCY_KEY_INVALID","Idempotency-Key는 소문자 표준 UUID여야 합니다.");}
    }
    @Transactional
    public TransferResult execute(ExecuteTransferRequest r,String rawKey){
        String key=key(rawKey);BankUser u=lockedUser();
        String hash=crypto.lookup("requests.transfer.v2",r.previewId()+"|"+SecurityConfig.hash(r.actionToken()));
        IdempotencyRecord old=keys.findByUserIdAndRequestKey(u.id,key).orElse(null);
        if(old!=null){
            if(!"TRANSFER_V2".equals(old.operation)||!hash.equals(old.requestHash))
                throw new ApiException(HttpStatus.CONFLICT,"IDEMPOTENCY_KEY_CONFLICT","같은 키가 다른 요청에 사용되었습니다.");
            return result(old.resultId,u.id); // Successful replay remains valid after expiry/consumption.
        }
        TransferPreview p=ownedPreview(r.previewId(),u.id);usable(p);
        TransferAction a=actions.findById(SecurityConfig.hash(r.actionToken())).orElse(null);
        if(a==null||!a.user.id.equals(u.id)||!a.preview.id.equals(p.id)||!"TRANSFER".equals(a.purpose)||a.consumed||!now().isBefore(a.expiresAt))
            throw new ApiException(HttpStatus.FORBIDDEN,"ACTION_TOKEN_INVALID","이 확인 건에 대한 비밀번호 재확인이 필요합니다.");
        TransferSnapshot snapshot=decrypt("transfer_previews.snapshot",p.id,p.snapshotEncrypted);
        // Recheck live balances and account state under the shared locks. Preview never reserves money.
        var posting=engine.post(u.id,p.source,p.target,p.amount,a.accountSecurityVersion);
        TransferRecord record=new TransferRecord();record.publicId=posting.id();record.user=u;record.preview=p;
        record.amount=p.amount;record.balanceAfter=posting.sourceBalance();record.createdAt=now();
        record.snapshotEncrypted=encrypt("transfer_records.snapshot",record.publicId,snapshot);records.save(record);
        p.resultId=record.publicId;a.consumed=true;
        keys.save(new IdempotencyRecord(u,key,hash,"TRANSFER_V2",record.publicId));
        return view(record);
    }
    @Transactional(readOnly=true)
    public TransferResult get(UUID id){return result(id.toString(),current.id());}
    private TransferResult result(String id,Long user){return view(records.findByPublicIdAndUserId(id,user).orElseThrow(TransferService::missing));}
    private TransferResult view(TransferRecord r){return new TransferResult(r.publicId,"completed",r.preview.id,
        decrypt("transfer_records.snapshot",r.publicId,r.snapshotEncrypted),money(r.amount),"0.00","KRW",money(r.balanceAfter),r.createdAt);}
    private String encrypt(String field,String id,TransferSnapshot snapshot){
        try{return crypto.encrypt(field,id,json.writeValueAsString(snapshot));}catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalStateException("이체 정보 저장 실패");}
    }
    private TransferSnapshot decrypt(String field,String id,String encrypted){
        try{return json.readValue(crypto.decrypt(field,id,encrypted),TransferSnapshot.class);}catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new IllegalStateException("이체 정보 조회 실패");}
    }
    @Transactional(readOnly=true)
    public TransferPage list(LocalDate fromInput,LocalDate toInput,int size,String cursor){
        BankUser u=current.get();LocalDate to=toInput==null?LocalDate.now(ZoneId.of("Asia/Seoul")):toInput;
        if(to.getYear()<1900||to.getYear()>9998)throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","날짜 범위를 확인해 주세요.","to");
        LocalDate from=fromInput==null?to.minusMonths(1):fromInput;
        if(from.getYear()<1900||from.getYear()>9998||from.isAfter(to)||to.isAfter(from.plusYears(1))||size<1||size>100)
            throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","기간은 최대 1년, size는 1~100이어야 합니다.");
        Instant start=from.atStartOfDay(ZoneId.of("Asia/Seoul")).toInstant(),end=to.plusDays(1).atStartOfDay(ZoneId.of("Asia/Seoul")).toInstant();
        String scope="transfers:"+u.publicId;
        var pos=cursor==null?null:cursors.decode(cursor,scope,from.toString(),to.toString(),"SENT");
        long maximum=pos==null?records.maximumId(u.id):pos.maximumId();
        Specification<TransferRecord> spec=(root,query,cb)->{
            var predicates=new ArrayList<Predicate>();
            predicates.add(cb.equal(root.get("user").get("id"),u.id));
            predicates.add(cb.greaterThanOrEqualTo(root.<Instant>get("createdAt"),start));
            predicates.add(cb.lessThan(root.<Instant>get("createdAt"),end));
            predicates.add(cb.lessThanOrEqualTo(root.<Long>get("id"),maximum));
            if(pos!=null)predicates.add(cb.or(cb.lessThan(root.<Instant>get("createdAt"),pos.time()),
                cb.and(cb.equal(root.get("createdAt"),pos.time()),cb.lessThan(root.<Long>get("id"),pos.id()))));
            return cb.and(predicates.toArray(Predicate[]::new));
        };
        var found=records.findAll(spec,PageRequest.of(0,size+1,Sort.by(Sort.Direction.DESC,"createdAt","id"))).getContent();
        boolean more=found.size()>size;var page=found.subList(0,Math.min(size,found.size()));String next=null;
        if(more){var last=page.get(page.size()-1);next=cursors.encode(new TransactionCursor.Position(scope,from.toString(),to.toString(),"SENT",maximum,last.createdAt,last.id));}
        return new TransferPage(page.stream().map(this::view).toList(),next,more,from,to);
    }
}
