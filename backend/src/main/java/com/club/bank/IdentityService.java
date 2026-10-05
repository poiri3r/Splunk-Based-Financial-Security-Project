package com.club.bank;
import java.time.*;
import java.util.*;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
import jakarta.persistence.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.http.HttpStatus;
import com.fasterxml.jackson.databind.ObjectMapper;

@Service
class IdentityService {
 private final CredentialPolicy credentials;
 private final RegistrationAudit audit;
 private final IdentityGate gate;private final UserRepo users;private final CurrentCustomer current;private final EntityManager em;
 private final ContactChallengeRepo challenges;private final RecoveryCodeRepo codes;private final IdentityRateRepo rates;
 private final RegistrationReceiptRepo receipts;private final TermsConsentRepo consents;private final TokenRepo tokens;
 private final TransferActionRepo transfers;private final SettingActionRepo settings;private final AccountRepo accounts;
 private final PasswordEncoder passwords;private final FieldCrypto crypto;private final VerificationSender sender;private final ObjectMapper json;
 private static final SecureRandom RANDOM=new SecureRandom();
 static final Map<String,String> TERMS=Map.of("SERVICE","2026-10-v1","PRIVACY","2026-10-v1");
 IdentityService(IdentityGate gate,UserRepo users,CurrentCustomer current,EntityManager em,ContactChallengeRepo challenges,
 RecoveryCodeRepo codes,IdentityRateRepo rates,RegistrationReceiptRepo receipts,TermsConsentRepo consents,TokenRepo tokens,
 TransferActionRepo transfers,SettingActionRepo settings,AccountRepo accounts,PasswordEncoder passwords,FieldCrypto crypto,VerificationSender sender,ObjectMapper json,CredentialPolicy credentials,RegistrationAudit audit){
 this.credentials=credentials;this.audit=audit;
 this.gate=gate;this.users=users;this.current=current;this.em=em;this.challenges=challenges;this.codes=codes;this.rates=rates;this.receipts=receipts;this.consents=consents;this.tokens=tokens;this.transfers=transfers;this.settings=settings;this.accounts=accounts;this.passwords=passwords;this.crypto=crypto;this.sender=sender;this.json=json;
 }
 static Instant now(){return Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);}
 static String secret(){byte[] b=new byte[32];RANDOM.nextBytes(b);return Base64.getUrlEncoder().withoutPadding().encodeToString(b);}
 private static IdentityFailure invalidRecovery(){return new IdentityFailure(HttpStatus.BAD_REQUEST,"RECOVERY_INVALID","복구 정보를 확인해 주세요.");}
 private static ApiException invalid(){return new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","입력값을 확인해 주세요.");}
 void rate(String subject,int max,int seconds){
  String id=crypto.lookup("identity.rate",subject);var r=rates.findById(id).orElse(null);
  if(r==null){r=new IdentityRate();r.id=id;r.until=now().plusSeconds(seconds);}
  if(!now().isBefore(r.until)){r.attempts=0;r.until=now().plusSeconds(seconds);}
  if(r.attempts>=max)throw new IdentityFailure(HttpStatus.TOO_MANY_REQUESTS,"RATE_LIMITED","잠시 후 다시 시도해 주세요.");
  r.attempts++;rates.save(r);
 }
 private BankUser locked(Long id){var u=users.findLockedById(id).orElseThrow(IdentityService::invalidRecovery);em.refresh(u,LockModeType.PESSIMISTIC_WRITE);return u;}
 private BankUser self(){var u=locked(current.id());current.requireFresh(u);return u;}
 private void password(String value,BankUser u){
  if(value.getBytes(StandardCharsets.UTF_8).length>72||!passwords.matches(value,u.passwordHash))throw new IdentityFailure(HttpStatus.UNAUTHORIZED,"REAUTHENTICATION_FAILED","비밀번호가 올바르지 않습니다.");
 }
 private void newPassword(String value){if(value.getBytes(StandardCharsets.UTF_8).length>72)throw CredentialPolicy.weak("password");}
 static String normalize(String channel,String value){
  value=value.strip();
  if(channel.equals("EMAIL")){
   if(value.length()>254||!value.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))throw invalid();
   int at=value.lastIndexOf('@');return value.substring(0,at)+value.substring(at).toLowerCase(Locale.ROOT);
  }
  value=value.replace(" ","").replace("-","");if(value.matches("0[0-9]{8,10}"))value="+82"+value.substring(1);
  if(!value.matches("\\+[1-9][0-9]{7,14}"))throw invalid();return value;
 }
 public List<Map<String,Object>> terms(){return List.of(
  Map.of("id","CHECKING","version","MOCK-CHECKING-2026-v1","required",false,"scope","ACCOUNT_OPEN","text","교육용 입출금통장입니다. 실제 입금이나 실명확인을 제공하지 않습니다."),
  Map.of("id","SERVICE","version",TERMS.get("SERVICE"),"required",true,"text","프로젝트 시연용 서비스 약관 초안입니다. 실제 금융거래를 제공하지 않습니다."),
  Map.of("id","PRIVACY","version",TERMS.get("PRIVACY"),"required",true,"text","프로젝트 시연용 개인정보 처리 동의 초안입니다. 가입 정보와 거래 시연 기록을 저장합니다. 실제 운영 전 별도 검토가 필요합니다."));}
 @Transactional(noRollbackFor=IdentityFailure.class) public Map<String,Object> start(ChallengeRequest r,String ip){
  gate.lock();rate("start-ip:"+ip,30,60);Long owner=r.purpose().equals("PROFILE")?self().id:null;
  String contact=normalize(r.channel(),r.contact());String lookup=crypto.lookup("bank_users."+(r.channel().equals("EMAIL")?"email":"phone"),contact);
  rate("send-minute:"+r.purpose()+":"+r.channel()+":"+lookup,1,60);rate("send-hour:"+r.purpose()+":"+r.channel()+":"+lookup,10,3600);
  challenges.invalidate(r.purpose(),r.channel(),lookup,owner);
  ContactChallenge c=new ContactChallenge();c.id=UUID.randomUUID().toString();c.userId=owner;c.purpose=r.purpose();c.channel=r.channel();
  c.contactLookup=lookup;c.contactEncrypted=crypto.encrypt("contact_challenges.contact",c.id,contact);
  String code=String.format(Locale.ROOT,"%06d",RANDOM.nextInt(1000000)),inbox=secret();
  c.codeHash=crypto.lookup("contact_challenges.code",c.id+":"+code);c.inboxHash=SecurityConfig.hash(inbox);c.expiresAt=now().plusSeconds(300);
  sender.deliver(c,code);challenges.save(c);
  return Map.of("challengeId",c.id,"expiresAt",c.expiresAt,"delivery","SIMULATED","inboxToken",inbox);
 }
 @Transactional(noRollbackFor=IdentityFailure.class) public Map<String,Object> verify(UUID id,VerifyChallengeRequest r,String ip){
  gate.lock();rate("verify-ip:"+ip,60,60);var c=challenges.findById(id.toString()).orElse(null);
  if(c==null||c.consumed||c.verified||!now().isBefore(c.expiresAt))throw new IdentityFailure(HttpStatus.BAD_REQUEST,"CHALLENGE_INVALID","인증 요청이 없거나 만료되었습니다.");
  if(c.userId!=null&&!c.userId.equals(self().id))throw new ApiException(HttpStatus.NOT_FOUND,"NOT_FOUND","인증 요청을 확인해 주세요.");
  if(!crypto.lookup("contact_challenges.code",c.id+":"+r.code()).equals(c.codeHash)){
   c.failures++;if(c.failures>=5)c.consumed=true;
   throw new IdentityFailure(HttpStatus.BAD_REQUEST,c.consumed?"CHALLENGE_LOCKED":"CODE_INVALID","인증번호가 올바르지 않습니다.");
  }
  String grant=secret();c.verified=true;c.grantHash=SecurityConfig.hash(grant);c.grantExpiresAt=now().plusSeconds(300);c.codeEncrypted=null;
  return Map.of("contactGrant",grant,"expiresAt",c.grantExpiresAt,"assurance","SIMULATED");
 }
 private ContactChallenge grant(String raw,String purpose,Long user){
  var c=challenges.findByGrantHash(SecurityConfig.hash(raw)).orElse(null);
  if(c==null||!c.verified||c.consumed||!purpose.equals(c.purpose)||!Objects.equals(user,c.userId)||!now().isBefore(c.grantExpiresAt))throw new ApiException(HttpStatus.FORBIDDEN,"CONTACT_GRANT_INVALID","해당 목적의 연락처 인증이 필요합니다.");return c;
 }
 private void apply(BankUser u,ContactChallenge c){
  String value=crypto.decrypt("contact_challenges.contact",c.id,c.contactEncrypted);
  if(c.channel.equals("EMAIL")){u.emailEncrypted=crypto.encrypt("bank_users.email",u.publicId,value);u.emailLookup=c.contactLookup;u.emailAssurance="SIMULATED";}
  else {u.phoneEncrypted=crypto.encrypt("bank_users.phone",u.publicId,value);u.phoneLookup=c.contactLookup;u.phoneAssurance="SIMULATED";}
  c.consumed=true;
 }
 @Transactional(noRollbackFor=IdentityFailure.class) public Map<String,String> register(ExtendedRegisterRequest r,String key,String ip){
  gate.lock();IdempotencyKeys.require(key);
  String name=r.name().strip();String hash;
  try{hash=crypto.lookup("registration.request",json.writeValueAsString(List.of(r.username(),r.password(),name,new TreeMap<>(r.termsVersions()),r.contactGrant()==null?"":r.contactGrant())));}catch(Exception e){throw new IllegalStateException();}
  var previous=receipts.findById(key).orElse(null);
  if(previous!=null){
   // v6 receipts used the fixed service terms version. Accept that legacy hash only
   // when the submitted complete terms still match the original current terms.
   boolean legacy=false;
   if(TERMS.equals(r.termsVersions()))try{
    legacy=previous.requestHash.equals(crypto.lookup("registration.request",json.writeValueAsString(List.of(r.username(),r.password(),name,TERMS.get("SERVICE"),r.contactGrant()==null?"":r.contactGrant()))));
   }catch(Exception ex){throw new IllegalStateException();}
   if(!previous.requestHash.equals(hash)&&!legacy)throw new ApiException(HttpStatus.CONFLICT,"IDEMPOTENCY_KEY_CONFLICT","다른 가입 요청에 사용한 키입니다.");
   users.findByPublicId(previous.customerId).ifPresent(audit::identify);
   audit.afterCommit("REPLAY",previous.customerId);return Map.of("customerId",previous.customerId);
  }
  rate("register-ip:"+ip,20,3600);newPassword(r.password());
  if(!TERMS.equals(r.termsVersions()))throw new ApiException(HttpStatus.CONFLICT,"TERMS_VERSION_REQUIRED","현재 필수 약관에 동의해 주세요.");
  if(name.isEmpty()||name.codePoints().anyMatch(Character::isISOControl))throw invalid();
  if(users.findByUsernameLookup(crypto.lookup("bank_users.username",r.username())).isPresent())throw new ApiException(HttpStatus.CONFLICT,"DUPLICATE_USERNAME","이미 사용 중인 아이디입니다.");
  ContactChallenge c=grant(r.contactGrant(),"REGISTER",null);
  if(!"SMS".equals(c.channel))throw new ApiException(HttpStatus.FORBIDDEN,"PHONE_CONFIRMATION_REQUIRED","모의 휴대폰 확인이 필요합니다.");
  audit.identify(c);
  credentials.password(r.password(),r.username(),crypto.decrypt("contact_challenges.contact",c.id,c.contactEncrypted));
  var u=new BankUser(r.username(),passwords.encode(r.password()),crypto);u.nameEncrypted=crypto.encrypt("bank_users.name",u.publicId,name);if(c!=null)apply(u,c);users.saveAndFlush(u);
  TERMS.forEach((term,version)->{var t=new TermsConsent();t.userId=u.id;t.termId=term;t.termVersion=version;t.acceptedAt=now();consents.save(t);});
  var receipt=new RegistrationReceipt();receipt.id=key;receipt.requestHash=hash;receipt.customerId=u.publicId;receipts.save(receipt);audit.afterCommit("SUCCESS",u.publicId);return Map.of("customerId",u.publicId);
 }
 @Transactional(noRollbackFor=IdentityFailure.class) public void contact(ContactApplyRequest r){
  gate.lock();var u=self();rate("auth:"+u.id,5,300);password(r.currentPassword(),u);apply(u,grant(r.contactGrant(),"PROFILE",u.id));
 }
 @Transactional(readOnly=true) public List<Map<String,Object>> consents(){return consents.findByUserIdOrderById(current.id()).stream().map(t->Map.<String,Object>of("id",t.termId,"version",t.termVersion,"acceptedAt",t.acceptedAt)).toList();}
 @Transactional(readOnly=true) public Map<String,Long> codeStatus(){return Map.of("remaining",codes.countByUserIdAndConsumedFalse(current.id()));}
 @Transactional(noRollbackFor=IdentityFailure.class) public Map<String,Object> issue(PasswordCheckRequest r){
  gate.lock();var u=self();rate("auth:"+u.id,5,300);password(r.currentPassword(),u);codes.revoke(u.id);List<String> raw=new ArrayList<>();
  for(int i=0;i<5;i++){String s=secret();var c=new RecoveryCode();c.codeHash=SecurityConfig.hash(s);c.userId=u.id;c.createdAt=now();codes.save(c);raw.add(s);}
  return Map.of("codes",raw,"oneTimeDisplay",true);
 }
 private RecoveryCode recovery(String raw){var c=codes.findById(SecurityConfig.hash(raw)).orElse(null);if(c==null||c.consumed)throw invalidRecovery();return c;}
 void revoke(BankUser u){u.authVersion++;tokens.revokeAll(u.id);transfers.revoke(u.id);settings.revoke(u.id);challenges.revoke(u.id);codes.revoke(u.id);}
 @Transactional(noRollbackFor=IdentityFailure.class) public void changePassword(PasswordChangeRequest r){
  gate.lock();var u=self();rate("auth:"+u.id,5,300);password(r.currentPassword(),u);
  credentials.newPassword(r.newPassword(),u);
  if(passwords.matches(r.newPassword(),u.passwordHash))throw CredentialPolicy.weak("newPassword");
  u.passwordHash=passwords.encode(r.newPassword());u.loginFailures=0;revoke(u);
 }
 @Transactional(noRollbackFor=IdentityFailure.class) public void resetPin(UUID id,PinResetRequest r){
  gate.lock();var u=self();rate("auth:"+u.id,5,300);password(r.currentPassword(),u);
  if((r.recoveryCode()==null)==(r.contactGrant()==null))throw invalidRecovery();
  ContactChallenge proof=null;
  if(r.recoveryCode()!=null){var c=recovery(r.recoveryCode());if(!c.userId.equals(u.id))throw invalidRecovery();}
  else {proof=grant(r.contactGrant(),"PROFILE",u.id);if(!"SMS".equals(proof.channel)||!proof.contactLookup.equals(u.phoneLookup))throw invalidRecovery();}
  var a=accounts.findByPublicIdAndOwnerId(id.toString(),u.id).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","계좌를 확인해 주세요."));
  accounts.findLockedById(a.id).orElseThrow();em.refresh(a,LockModeType.PESSIMISTIC_WRITE);
  SavingsService.checking(a);credentials.pin(r.newPin(),u);a.pinHash=passwords.encode(r.newPin());a.pinFailures=0;a.pinLockedUntil=null;a.settingsVersion++;a.securityVersion++;if(proof!=null)proof.consumed=true;revoke(u);
 }
}
class IdentityFailure extends ApiException {IdentityFailure(HttpStatus status,String code,String message){super(status,code,message);}}
