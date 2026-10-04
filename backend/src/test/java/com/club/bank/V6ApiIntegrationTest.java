package com.club.bank;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import java.util.*;
import java.util.concurrent.*;
import java.time.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@SpringBootTest(properties="bank.demo-inbox-key=test-only-demo-inbox-secret-32-characters")
@AutoConfigureMockMvc @ActiveProfiles({"demo","demo-verification"})
class V6ApiIntegrationTest extends V6Support {
 @Test void loginIpBudgetCannotBeBypassedWithUnknownUsers()throws Exception{
  String ip="rate-"+key();
  for(int i=0;i<31;i++){
   var response=mvc.perform(body(post("/api/v2/auth/login"),Map.of("username","unknown"+i,"password",PASSWORD)).with(req->{req.setRemoteAddr(ip);return req;})).andReturn().getResponse();
   assertEquals(i<30?401:429,response.getStatus());
   if(i==30)assertEquals("RATE_LIMITED",json.readTree(response.getContentAsString()).path("code").asText());
  }
 }
 @Test void failedProfileReauthenticationHasPersistentAttemptBudget()throws Exception{
  var c=customer();var r=Map.of("version",me(c).path("version").asLong(),"name","김시연","phone",c.phone(),"email","test@example.test","currentPassword","wrong");
  for(int i=0;i<5;i++)call(auth(body(put("/api/v2/me/profile"),r),c),401);
  assertEquals("RATE_LIMITED",call(auth(body(put("/api/v2/me/profile"),r),c),429).path("code").asText());
  assertTrue(me(c).path("bankingReady").asBoolean());
 }
 @Test void registrationRequiresSmsAndTermsAndReplaysExactly()throws Exception{
  String user="reg"+IDS.incrementAndGet();var missing=new HashMap<String,Object>(signup(user,"x"));missing.remove("contactGrant");
  call(body(post("/api/v2/auth/register").header("Idempotency-Key",key()),missing),400);
  String email=contact("REGISTER","EMAIL",user+"@example.test",null);
  assertEquals("PHONE_CONFIRMATION_REQUIRED",call(body(post("/api/v2/auth/register").header("Idempotency-Key",key()),signup(user,email)),403).path("code").asText());
  String grant=contact("REGISTER","SMS",phone(),null),k=key();var r=new HashMap<String,Object>(signup(user,grant));r.put("termsVersions",Map.of());
  call(body(post("/api/v2/auth/register").header("Idempotency-Key",k),r),409);r.put("termsVersions",IdentityService.TERMS);
  var first=call(body(post("/api/v2/auth/register").header("Idempotency-Key",k),r),201);
  assertEquals(first,call(body(post("/api/v2/auth/register").header("Idempotency-Key",k),r),201));
  r.put("username",user+"z");call(body(post("/api/v2/auth/register").header("Idempotency-Key",key()),r),403);
  assertEquals(2,jdbc.queryForObject("select count(*) from terms_consents where user_id=(select id from bank_users where public_id=?)",Integer.class,first.path("customerId").asText()));
 }
 @Test void legacyEndpointsCannotRegisterOpenOrTransfer()throws Exception{
  var c=customer();long users=jdbc.queryForObject("select count(*) from bank_users",Long.class),accounts=jdbc.queryForObject("select count(*) from accounts",Long.class);
  for(String path:List.of("/api/auth/register","/api/auth/login","/api/accounts","/api/transfers","/api/deposits")){
   call(auth(body(post(path),Map.of("username","legacy","password",PASSWORD)),c),403);
   call(body(post(path),Map.of()),401);
  }
  assertEquals(users,jdbc.queryForObject("select count(*) from bank_users",Long.class));assertEquals(accounts,jdbc.queryForObject("select count(*) from accounts",Long.class));
 }
 @Test void loginLocksOnThirdFailureRevokesSessionsAndRequiresProofToUnlock()throws Exception{
  var c=customer();for(int i=1;i<=3;i++)call(body(post("/api/v2/auth/login"),Map.of("username",c.username(),"password","wrong")),i==3?423:401);
  call(auth(get("/api/v2/auth/me"),c),401);call(body(post("/api/v2/auth/login"),Map.of("username",c.username(),"password",PASSWORD)),423);
  assertEquals(3,jdbc.queryForObject("select login_failures from bank_users where id=?",Integer.class,uid(c)));
  String g=resetGrant(c,"LOGIN_UNLOCK");call(body(post("/api/v2/recovery/login-unlock"),Map.of("resetToken",g)),204);
  call(body(post("/api/v2/recovery/login-unlock"),Map.of("resetToken",g)),400);assertNotNull(login(c.username(),PASSWORD));
 }
 @Test void concurrentLoginFailuresDoNotLoseCounts()throws Exception{
  var c=customer();var pool=Executors.newFixedThreadPool(3);
  try{var tasks=new ArrayList<Future<Integer>>();for(int i=0;i<3;i++)tasks.add(pool.submit(()->mvc.perform(body(post("/api/v2/auth/login"),Map.of("username",c.username(),"password","bad"))).andReturn().getResponse().getStatus()));
   var status=new ArrayList<Integer>();for(var f:tasks)status.add(f.get(20,TimeUnit.SECONDS));Collections.sort(status);assertEquals(List.of(401,401,423),status);
  }finally{pool.shutdownNow();}
  assertEquals(3,jdbc.queryForObject("select login_failures from bank_users where id=?",Integer.class,uid(c)));
 }
 @Test void successfulLoginClearsFailuresAndUnknownUserHasGenericError()throws Exception{
  var c=customer();call(body(post("/api/v2/auth/login"),Map.of("username",c.username(),"password","bad")),401);login(c.username(),PASSWORD);
  assertEquals(0,jdbc.queryForObject("select login_failures from bank_users where id=?",Integer.class,uid(c)));
  assertEquals("LOGIN_FAILED",call(body(post("/api/v2/auth/login"),Map.of("username","missing"+IDS.incrementAndGet(),"password",PASSWORD)),401).path("code").asText());
 }
 @Test void idleExpiryAndStatusPollingCannotReviveSession()throws Exception{
  var c=customer();var old=java.sql.Timestamp.from(Instant.now().minusSeconds(590).truncatedTo(java.time.temporal.ChronoUnit.MICROS));jdbc.update("update auth_tokens set last_activity_at=? where token_hash=?",old,SecurityConfig.hash(c.token()));
  call(auth(get("/api/v2/auth/session"),c),200);
  assertEquals(old.toInstant(),jdbc.queryForObject("select last_activity_at from auth_tokens where token_hash=?",java.time.OffsetDateTime.class,SecurityConfig.hash(c.token())).toInstant());
  call(auth(post("/api/v2/auth/session/extend"),c),200);
  jdbc.update("update auth_tokens set last_activity_at=? where token_hash=?",java.sql.Timestamp.from(Instant.now().minusSeconds(601)),SecurityConfig.hash(c.token()));
  call(auth(post("/api/v2/auth/session/extend"),c),401);call(auth(get("/api/v2/accounts"),c),401);
 }
 @Test void absoluteExpiryAndLogoutAreEnforced()throws Exception{
  var c=customer();String other=login(c.username(),PASSWORD);call(auth(post("/api/v2/auth/logout"),c),204);call(auth(get("/api/v2/auth/me"),c),401);
  call(get("/api/v2/auth/me").header("Authorization","Bearer "+other),200);
  jdbc.update("update auth_tokens set expires_at=? where token_hash=?",java.sql.Timestamp.from(Instant.now().minusSeconds(1)),SecurityConfig.hash(other));
  call(get("/api/v2/auth/me").header("Authorization","Bearer "+other),401);
 }
 @Test void accountRecoveryAndPasswordResetBindPurposeExpiryAndVersion()throws Exception{
  var c=customer();assertEquals(c.username(),call(body(post("/api/v2/recovery/verifications"),proof(c,"USERNAME",PIN)),200).path("username").asText());
  String wrongPurpose=resetGrant(c,"LOGIN_UNLOCK");call(body(post("/api/v2/recovery/password"),Map.of("resetToken",wrongPurpose,"newPassword","Updated!Pass729")),400);
  String expired=resetGrant(c,"PASSWORD");jdbc.update("update recovery_grants set expires_at=? where token_hash=?",java.sql.Timestamp.from(Instant.now().minusSeconds(1)),SecurityConfig.hash(expired));
  call(body(post("/api/v2/recovery/password"),Map.of("resetToken",expired,"newPassword","Updated!Pass729")),400);
  String a=resetGrant(c,"PASSWORD"),b=resetGrant(c,"PASSWORD");
  call(body(post("/api/v2/recovery/password"),Map.of("resetToken",a,"newPassword","Updated!Pass729")),204);
  for(String token:List.of(a,b))call(body(post("/api/v2/recovery/password"),Map.of("resetToken",token,"newPassword","Different!P729")),400);
  call(auth(get("/api/v2/auth/me"),c),401);assertNotNull(login(c.username(),"Updated!Pass729"));
 }
 @Test void resetGrantCanBeConsumedOnlyOnceConcurrently()throws Exception{
  var c=customer();String g=resetGrant(c,"PASSWORD");var pool=Executors.newFixedThreadPool(2);
  try{Callable<Integer> task=()->mvc.perform(body(post("/api/v2/recovery/password"),Map.of("resetToken",g,"newPassword","Updated!Pass729"))).andReturn().getResponse().getStatus();
   var a=pool.submit(task);var b=pool.submit(task);var statuses=new ArrayList<>(List.of(a.get(20,TimeUnit.SECONDS),b.get(20,TimeUnit.SECONDS)));Collections.sort(statuses);assertEquals(List.of(204,400),statuses);
  }finally{pool.shutdownNow();}
 }
 @Test void recoveryCodesAreOptionalOneTimeFallbackAndStoredHashed()throws Exception{
  var c=customer();var codes=call(auth(body(post("/api/v2/me/recovery-codes"),Map.of("currentPassword",PASSWORD)),c),200).path("codes");assertEquals(5,codes.size());String code=codes.get(0).asText();
  assertEquals(1,jdbc.queryForObject("select count(*) from recovery_codes where code_hash=?",Integer.class,SecurityConfig.hash(code)));
  var proof=Map.of("purpose","USERNAME","method","RECOVERY_CODE","recoveryCode",code);
  assertEquals(c.username(),call(body(post("/api/v2/recovery/verifications"),proof),200).path("username").asText());call(body(post("/api/v2/recovery/verifications"),proof),400);
  call(body(post("/api/v2/recovery/username"),Map.of("recoveryCode",codes.get(1).asText())),401);
 }
 @Test void weakPasswordsAndReuseRejectedWithoutConsumingResetGrant()throws Exception{
  var c=customer();String g=resetGrant(c,"PASSWORD");
  for(String pass:List.of(PASSWORD,"Password1234!","passwordonlylong","AAAAAAAAaaaa1!"))call(body(post("/api/v2/recovery/password"),Map.of("resetToken",g,"newPassword",pass)),400);
  call(body(post("/api/v2/recovery/password"),Map.of("resetToken",g,"newPassword","Updated!Pass729")),204);
 }
 @Test void profileCannotErasePhoneChangeNameOrSilentlyLoseSession()throws Exception{
  var c=customer();var me=me(c);var r=new HashMap<String,Object>();r.put("version",me.path("version").asLong());r.put("name","김시연");r.put("phone",c.phone());r.put("email","test@example.test");r.put("currentPassword","wrong");
  assertEquals("REAUTHENTICATION_FAILED",call(auth(body(put("/api/v2/me/profile"),r),c),401).path("code").asText());me(c);
  r.put("currentPassword",PASSWORD);r.put("phone",null);call(auth(body(put("/api/v2/me/profile"),r),c),403);
  r.put("phone",c.phone());r.put("name","다른이름");call(auth(body(put("/api/v2/me/profile"),r),c),409);
  r.put("name","김시연");assertEquals("test@example.test",call(auth(body(put("/api/v2/me/profile"),r),c),200).path("email").asText());
 }
 @Test void contactChangeNeedsOwnerBoundGrantAndLegacySetupBlocksTransactions()throws Exception{
  var c=customer();String phone=phone(),g=contact("PROFILE","SMS",phone,c);var other=customer();
  call(auth(body(put("/api/v2/me/contact"),Map.of("currentPassword",PASSWORD,"contactGrant",g)),other),403);
  call(auth(body(put("/api/v2/me/contact"),Map.of("currentPassword",PASSWORD,"contactGrant",g)),c),204);assertEquals("+82"+phone.substring(1),me(c).path("phone").asText());
  jdbc.update("update bank_users set phone_assurance='UNVERIFIED' where id=?",uid(c));
  call(auth(body(post("/api/v2/accounts").header("Idempotency-Key",key()),Map.of("pin",PIN,"termsVersion","MOCK-CHECKING-2026-v1")),c),403);
  assertFalse(me(c).path("bankingReady").asBoolean());
 }
 @Test void openingRequiresPinAndTermsAndRecordsConsentWithReplay()throws Exception{
  var c=customer();call(auth(post("/api/v2/accounts").header("Idempotency-Key",key()),c),400);
  for(String pin:List.of("1234","1111","9876"))call(auth(body(post("/api/v2/accounts").header("Idempotency-Key",key()),Map.of("pin",pin,"termsVersion","MOCK-CHECKING-2026-v1")),c),400);
  String k=key();var req=Map.of("pin",PIN,"termsVersion","MOCK-CHECKING-2026-v1");var first=call(auth(body(post("/api/v2/accounts").header("Idempotency-Key",k),req),c),201);
  assertEquals(first,call(auth(body(post("/api/v2/accounts").header("Idempotency-Key",k),req),c),201));
  call(auth(body(post("/api/v2/accounts").header("Idempotency-Key",k),Map.of("pin","7391","termsVersion","MOCK-CHECKING-2026-v1")),c),409);
  assertEquals("MOCK-CHECKING-2026-v1",jdbc.queryForObject("select opening_terms_version from accounts where public_id=?",String.class,first.path("accountId").asText()));
 }
 @Test void fourWrongPinsLockPermanentlyAndSmsResetRequiresRegisteredPhone()throws Exception{
  var c=customer();for(int i=0;i<4;i++)call(body(post("/api/v2/recovery/verifications"),proof(c,"USERNAME","0000")),i==3?423:403);
  jdbc.update("update accounts set pin_locked_until=? where public_id=?",java.sql.Timestamp.from(Instant.now().minusSeconds(3600)),c.id());
  call(body(post("/api/v2/recovery/verifications"),proof(c,"USERNAME",PIN)),423);
  String wrong=contact("PROFILE","SMS",phone(),c);call(auth(body(post("/api/v2/accounts/"+c.id()+"/pin/reset"),Map.of("currentPassword",PASSWORD,"contactGrant",wrong,"newPin","7391")),c),400);
  String correct=contact("PROFILE","SMS",c.phone(),c);
  call(auth(body(post("/api/v2/accounts/"+c.id()+"/pin/reset"),Map.of("currentPassword",PASSWORD,"contactGrant",correct,"newPin","7391")),c),204);
  call(auth(get("/api/v2/auth/me"),c),401);call(body(post("/api/v2/recovery/verifications"),proof(c,"USERNAME","7391")),200);
 }
 @Test void transferPostsOnceKeepsLedgerAndOwnershipAndEncryptedApproval()throws Exception{
  var a=customer();var b=customer();deposit(a,"100");String p=preview(a,b,"30").path("previewId").asText(),g=approval(a,p,PIN),k=key();
  assertEquals(1,jdbc.queryForObject("select count(*) from transfer_actions where token_hash=?",Integer.class,SecurityConfig.hash(g)));
  var done=call(execute(a,p,g,k),200);assertEquals(done,call(execute(a,p,g,k),200));assertEquals("70.00",balance(a));assertEquals("30.00",balance(b));
  assertEquals(2,jdbc.queryForObject("select count(*) from ledger_entries where transfer_id=?",Integer.class,done.path("transferId").asText()));
  call(auth(get("/api/v2/accounts/"+a.id()),b),404);call(auth(get("/api/v2/transfers/"+done.path("transferId").asText()),b),404);
 }
 @Test void concurrentTransfersShareDailyLimitAndFailedLedgerRollsBack()throws Exception{
  var a=customer();var b=customer();deposit(a,"100");jdbc.update("update bank_users set daily_limit=60 where id=?",uid(a));
  String p=preview(a,b,"40").path("previewId").asText(),q=preview(a,b,"40").path("previewId").asText(),g=approval(a,p,PIN),h=approval(a,q,PIN);var pool=Executors.newFixedThreadPool(2);
  try{var x=pool.submit(()->mvc.perform(execute(a,p,g,key())).andReturn().getResponse().getStatus());var y=pool.submit(()->mvc.perform(execute(a,q,h,key())).andReturn().getResponse().getStatus());var s=new ArrayList<>(List.of(x.get(20,TimeUnit.SECONDS),y.get(20,TimeUnit.SECONDS)));Collections.sort(s);assertEquals(List.of(200,409),s);}finally{pool.shutdownNow();}
  assertEquals("60.00",balance(a));assertEquals("40.00",balance(b));
  String next=preview(a,b,"10").path("previewId").asText(),grant=approval(a,next,PIN),k=key();
  jdbc.execute("alter table transfer_records add constraint fail_v6_record check(preview_id <> '"+next+"')");
  try{call(execute(a,next,grant,k),500);assertEquals("60.00",balance(a));}finally{jdbc.execute("alter table transfer_records drop constraint fail_v6_record");}
  call(execute(a,next,grant,k),200);assertEquals("50.00",balance(a));
 }
 @Test void liveRestrictionsAndMissingPinCannotBeBypassed()throws Exception{
  var a=customer();var b=customer();deposit(a,"100");String p=preview(a,b,"10").path("previewId").asText(),g=approval(a,p,PIN);
  jdbc.update("update accounts set debit_enabled=false,security_version=security_version+1 where public_id=?",a.id());call(execute(a,p,g,key()),409);
  jdbc.update("update accounts set debit_enabled=true,pin_hash=null where public_id=?",a.id());call(execute(a,p,g,key()),403);
  jdbc.update("update accounts set status='BLOCKED' where public_id=?",a.id());call(auth(body(post("/api/v2/demo/deposits").header("Idempotency-Key",key()),Map.of("accountNumber",a.number(),"amount","1")),a),409);
 }
 @Test void queryCursorPreferencesFavoritesAndLimitsRemainFunctional()throws Exception{
  var a=customer();var b=customer();deposit(a,"1");deposit(a,"2");deposit(a,"3");
  String path="/api/v2/accounts/"+a.id()+"/transactions";var first=call(auth(get(path).param("size","2"),a),200);assertTrue(first.path("hasNext").asBoolean());
  assertEquals(1,call(auth(get(path).param("size","2").param("cursor",first.path("nextCursor").asText()),a),200).path("items").size());
  call(auth(get(path).param("cursor","bad"),a),400);
  var prefs=call(auth(body(patch("/api/v2/accounts/"+a.id()+"/preferences"),Map.of("version",0,"alias","생활비","hidden",true)),a),200);
  assertEquals(0,call(auth(get("/api/v2/accounts"),a),200).path("items").size());assertEquals(1,call(auth(get("/api/v2/accounts").param("includeHidden","true"),a),200).path("items").size());
  var favorite=call(auth(body(post("/api/v2/beneficiaries"),Map.of("bankCode","LOCAL","accountNumber",b.number(),"alias","회비")),a),201);
  call(auth(delete("/api/v2/beneficiaries/"+favorite.path("id").asText()).param("version","0"),b),404);
  call(auth(delete("/api/v2/beneficiaries/"+favorite.path("id").asText()).param("version","0"),a),204);
  var limits=call(auth(get("/api/v2/me/transfer-limits"),a),200);var changes=Map.of("version",limits.path("version").asLong(),"perTransfer","10","daily","20");
  String g=call(auth(body(post("/api/v2/auth/step-up"),Map.of("purpose","TRANSFER_LIMITS","targetId",limits.path("customerId").asText(),"password",PASSWORD,"changes",changes)),a),200).path("actionToken").asText();
  call(auth(body(put("/api/v2/me/transfer-limits"),Map.of("changes",changes,"actionToken",g)),a),200);
  assertEquals("20.00",call(auth(get("/api/v2/me/transfer-limits"),a),200).path("daily").asText());
 }
 @Test void publicCatalogAndEncryptedStorageRemainCorrect()throws Exception{
  assertEquals(2,call(get("/api/v2/savings-products"),200).size());var c=customer();
  var row=jdbc.queryForMap("select username_enc,name_encrypted,phone_encrypted,password_hash from bank_users where id=?",uid(c));
  assertTrue(row.get("USERNAME_ENC").toString().startsWith("v1:"));assertFalse(row.toString().contains(PASSWORD));assertFalse(row.toString().contains(c.phone()));
  assertTrue(jdbc.queryForObject("select pin_hash from accounts where public_id=?",String.class,c.id()).startsWith("$2"));
 }
}
