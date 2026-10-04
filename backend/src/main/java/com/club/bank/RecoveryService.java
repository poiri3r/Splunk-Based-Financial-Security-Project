package com.club.bank;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import jakarta.persistence.*;
import jakarta.validation.constraints.*;
import java.util.*;

record RecoveryProof(@NotBlank @Pattern(regexp="USERNAME|PASSWORD|LOGIN_UNLOCK") String purpose,
 @NotBlank @Pattern(regexp="ACCOUNT|RECOVERY_CODE") String method,
 @Size(max=100) String name,@Pattern(regexp="[0-9]{10,20}") String accountNumber,
 @Pattern(regexp="[0-9]{4}") String pin,@Size(max=128) String recoveryCode){}
record PasswordReset(@NotBlank @Size(max=128) String resetToken,@NotBlank @Size(min=12,max=64) String newPassword){}
record LoginUnlock(@NotBlank @Size(max=128) String resetToken){}

@Service class RecoveryService {
 private final IdentityGate gate;private final IdentityService identity;private final UserRepo users;
 private final AccountRepo accounts;private final RecoveryCodeRepo codes;private final RecoveryGrantRepo grants;
 private final FieldCrypto crypto;private final AccountPolicy policy;private final CredentialPolicy credentials;
 private final PasswordEncoder passwords;private final EntityManager em;
 RecoveryService(IdentityGate gate,IdentityService identity,UserRepo users,AccountRepo accounts,RecoveryCodeRepo codes,
 RecoveryGrantRepo grants,FieldCrypto crypto,AccountPolicy policy,CredentialPolicy credentials,PasswordEncoder passwords,EntityManager em){
  this.gate=gate;this.identity=identity;this.users=users;this.accounts=accounts;this.codes=codes;this.grants=grants;
  this.crypto=crypto;this.policy=policy;this.credentials=credentials;this.passwords=passwords;this.em=em;
 }
 private ApiException invalid(){return new IdentityFailure(HttpStatus.BAD_REQUEST,"RECOVERY_INVALID","복구 정보를 확인해 주세요.");}
 private BankUser lock(Long id){var u=(BankUser)org.hibernate.Hibernate.unproxy(users.findLockedById(id).orElseThrow(this::invalid));em.refresh(u,LockModeType.PESSIMISTIC_WRITE);return u;}
 @Transactional(noRollbackFor={IdentityFailure.class,PinFailure.class}) public Map<String,Object> verify(RecoveryProof r,String ip){
  gate.lock();identity.rate("recovery-proof-ip:"+ip,20,3600);BankUser u;
  if(r.method().equals("ACCOUNT")){
   if(r.name()==null||r.accountNumber()==null||r.pin()==null||r.recoveryCode()!=null)throw invalid();
   var a=accounts.findByNumberLookup(crypto.lookup("accounts.number",r.accountNumber())).orElseThrow(this::invalid);
   u=lock(a.owner.getId());accounts.findLockedById(a.id).orElseThrow();em.refresh(a,LockModeType.PESSIMISTIC_WRITE);
   if(!"CHECKING".equals(a.accountType)||!"ACTIVE".equals(a.status)||a.pinHash==null||u.nameEncrypted==null
      ||!crypto.lookup("recovery.name",crypto.decrypt("bank_users.name",u.publicId,u.nameEncrypted)).equals(crypto.lookup("recovery.name",r.name().strip())))throw invalid();
   policy.verifyPin(a,r.pin());
  }else{
   if(r.recoveryCode()==null||r.name()!=null||r.accountNumber()!=null||r.pin()!=null)throw invalid();
   var c=codes.findById(SecurityConfig.hash(r.recoveryCode())).orElseThrow(this::invalid);
   if(c.consumed)throw invalid();u=lock(c.userId);c.consumed=true;
  }
  if(r.purpose().equals("USERNAME"))return Map.of("username",u.username(crypto));
  String token=IdentityService.secret();var g=new RecoveryGrant();g.tokenHash=SecurityConfig.hash(token);g.userId=u.id;g.authVersion=u.authVersion;
  g.purpose=r.purpose();g.expiresAt=IdentityService.now().plusSeconds(300);grants.save(g);
  return Map.of("resetToken",token,"expiresAt",g.expiresAt,"purpose",g.purpose);
 }
 private RecoveryGrant grant(String raw,String purpose){
  var g=grants.findById(SecurityConfig.hash(raw)).orElseThrow(this::invalid);
  if(g.consumed||!g.purpose.equals(purpose)||!IdentityService.now().isBefore(g.expiresAt))throw invalid();return g;
 }
 @Transactional(noRollbackFor=IdentityFailure.class) public void password(PasswordReset r,String ip){
  gate.lock();identity.rate("reset-ip:"+ip,20,3600);var g=grant(r.resetToken(),"PASSWORD");var u=lock(g.userId);
  if(u.authVersion!=g.authVersion)throw invalid();credentials.newPassword(r.newPassword(),u);
  if(passwords.matches(r.newPassword(),u.passwordHash))throw CredentialPolicy.weak("newPassword");
  u.passwordHash=passwords.encode(r.newPassword());u.loginFailures=0;g.consumed=true;identity.revoke(u);
 }
 @Transactional(noRollbackFor=IdentityFailure.class) public void unlock(LoginUnlock r,String ip){
  gate.lock();identity.rate("unlock-ip:"+ip,20,3600);var g=grant(r.resetToken(),"LOGIN_UNLOCK");var u=lock(g.userId);
  if(u.authVersion!=g.authVersion)throw invalid();u.loginFailures=0;g.consumed=true;identity.revoke(u);
 }
}
