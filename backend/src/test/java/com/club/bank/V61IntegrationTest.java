package com.club.bank;
import java.util.*;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.slf4j.LoggerFactory;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@SpringBootTest(properties="bank.demo-inbox-key=test-only-demo-inbox-secret-32-characters")
@AutoConfigureMockMvc @ActiveProfiles({"demo","demo-verification"})
class V61IntegrationTest extends V6Support {
 @org.springframework.beans.factory.annotation.Autowired RegistrationAudit audit;
 @org.springframework.beans.factory.annotation.Autowired org.springframework.transaction.PlatformTransactionManager transactions;
 @Test void auditSuccessRequiresCommitAndRollbackProducesFailure()throws Exception{
  Logger logger=(Logger)LoggerFactory.getLogger("BANK_REGISTRATION_AUDIT");var appender=new ListAppender<ILoggingEvent>();appender.start();logger.addAppender(appender);
  try{
   for(boolean rollback:List.of(true,false)){
    var req=new org.springframework.mock.web.MockHttpServletRequest("POST","/api/v2/auth/register");var res=new org.springframework.mock.web.MockHttpServletResponse();
    audit.doFilter(req,res,(q,s)->{
     new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(status->{
      audit.afterCommit("SUCCESS","committed-customer");
      assertEquals(rollback?0:1,appender.list.size()); // no premature event
      if(rollback){status.setRollbackOnly();RegistrationAudit.failure("INTERNAL_ERROR");}
     });
    });
   }
   var failed=json.readTree(appender.list.get(0).getFormattedMessage());var committed=json.readTree(appender.list.get(1).getFormattedMessage());
   assertEquals("FAILURE",failed.path("outcome").asText());assertTrue(failed.path("customerId").isNull());assertEquals("INTERNAL_ERROR",failed.path("reasonCode").asText());
   assertEquals("SUCCESS",committed.path("outcome").asText());assertEquals("committed-customer",committed.path("customerId").asText());
  }finally{logger.detachAppender(appender);appender.stop();}
 }
 @Test void simultaneousRegistrationReplayCreatesOneUserAndOneReceipt()throws Exception{
  String name="parallel"+IDS.incrementAndGet(),grant=contact("REGISTER","SMS",phone(),null),k=key();var r=signup(name,grant);
  var pool=java.util.concurrent.Executors.newFixedThreadPool(2);
  try{
   java.util.concurrent.Callable<String> task=()->{
    var res=mvc.perform(body(post("/api/v2/auth/register").header("Idempotency-Key",k),r)).andReturn().getResponse();
    assertEquals(201,res.getStatus(),res.getContentAsString());return res.getContentAsString();
   };
   var results=pool.invokeAll(List.of(task,task));assertEquals(results.get(0).get(),results.get(1).get());
   assertEquals(1,jdbc.queryForObject("select count(*) from bank_users where username_lookup=?",Integer.class,crypto.lookup("bank_users.username",name)));
   assertEquals(1,jdbc.queryForObject("select count(*) from registration_receipts where id=?",Integer.class,k));
  }finally{pool.shutdownNow();}
 }

 @Test void allIdempotentEndpointsUseSameMissingAndMalformedKeyError()throws Exception{
  var c=customer();String id=key();
  var requests=new LinkedHashMap<String,Object>();
  requests.put("/api/v2/auth/register",signup("keytestuser","unused-grant"));
  requests.put("/api/v2/accounts",Map.of("pin",PIN,"termsVersion","MOCK-CHECKING-2026-v1"));
  requests.put("/api/v2/demo/deposits",Map.of("accountNumber",c.number(),"amount","10.00"));
  requests.put("/api/v2/transfers",Map.of("previewId",id,"actionToken","unused"));
  requests.put("/api/v2/savings",Map.of("productId","mock","sourceAccountId",c.id(),"amount","100.00","termsVersion","mock","password",PASSWORD,"pin",PIN));
  requests.put("/api/v2/savings/"+id+"/payments",Map.of("sourceAccountId",c.id(),"version",0,"password",PASSWORD,"pin",PIN));
  requests.put("/api/v2/savings/"+id+"/closure",Map.of("targetAccountId",c.id(),"version",0,"quoteDate",LocalDate.now().toString(),"quoteToken","unused","password",PASSWORD));
  for(var entry:requests.entrySet())for(String k:List.of("","not-a-uuid")){
   var req=auth(body(post(entry.getKey()),entry.getValue()),c);if(!k.isEmpty())req.header("Idempotency-Key",k);
   assertEquals("IDEMPOTENCY_KEY_INVALID",call(req,400).path("code").asText(),entry.getKey());
  }
 }
 @Test void newPasswordFieldIsConsistentForValidationPolicyBytesAndReuse()throws Exception{
  var c=customer();String reset=resetGrant(c,"PASSWORD");
  for(String password:List.of("short","가".repeat(25)+"A2!","Password1234!",PASSWORD)){
   assertEquals("newPassword",call(auth(body(put("/api/v2/me/password"),Map.of("currentPassword",PASSWORD,"newPassword",password)),c),400).path("field").asText());
   assertEquals("newPassword",call(body(post("/api/v2/recovery/password"),Map.of("resetToken",reset,"newPassword",password)),400).path("field").asText());
  }
  var r=new HashMap<>(signup("bytepassworduser","unused"));r.put("password","가".repeat(25)+"A2!");
  assertEquals("password",call(body(post("/api/v2/auth/register").header("Idempotency-Key",key()),r),400).path("field").asText());
 }
 @Test void settingsFailuresReturnRetryAfterWithoutBlockingPinTransfer()throws Exception{
  var a=customer();var b=customer();deposit(a,"100.00");var p=preview(a,b,"1.00").path("previewId").asText();
  var limits=call(auth(get("/api/v2/me/transfer-limits"),a),200);
  Map<String,Object> settings=new HashMap<>(Map.of("purpose","TRANSFER_LIMITS","targetId",limits.path("customerId").asText(),"password","wrong","changes",Map.of("version",limits.path("version").asLong(),"perTransfer","100.00","daily","100.00")));
  Map<String,Object> transfer=new HashMap<>(Map.of("purpose","TRANSFER","targetId",p,"password","wrong","pin",PIN));
  for(int i=0;i<4;i++)assertEquals("REAUTHENTICATION_FAILED",call(auth(body(post("/api/v2/auth/step-up"),settings),a),401).path("code").asText());
  settings.put("password",PASSWORD);call(auth(body(post("/api/v2/auth/step-up"),settings),a),200);
  settings.put("password","wrong");
  var res=mvc.perform(auth(body(post("/api/v2/auth/step-up"),settings),a)).andReturn().getResponse();
  assertEquals(429,res.getStatus(),res.getContentAsString());assertEquals("RATE_LIMITED",json.readTree(res.getContentAsString()).path("code").asText());assertEquals("300",res.getHeader("Retry-After"));
  assertEquals(429,mvc.perform(auth(body(post("/api/v2/auth/step-up"),settings),a)).andReturn().getResponse().getStatus());
  call(auth(body(post("/api/v2/auth/step-up"),transfer),a),200);
  // Password step-up block must not turn into a login lock.
  login(a.username(),PASSWORD);
 }
 @Test void registrationReplayBypassesBudgetAndConflictingTermsStillConflict()throws Exception{
  String username="replay"+IDS.incrementAndGet(),grant=contact("REGISTER","SMS",phone(),null),k=key(),ip="replay-budget-"+key();
  var r=signup(username,grant);
  var first=mvc.perform(body(post("/api/v2/auth/register").header("Idempotency-Key",k),r).with(q->{q.setRemoteAddr(ip);return q;})).andReturn().getResponse();assertEquals(201,first.getStatus());
  String rateId=crypto.lookup("identity.rate","register-ip:"+ip);
  jdbc.update("update identity_rates set attempts=20 where id=?",rateId);
  var replay=mvc.perform(body(post("/api/v2/auth/register").header("Idempotency-Key",k),r).with(q->{q.setRemoteAddr(ip);return q;})).andReturn().getResponse();
  assertEquals(201,replay.getStatus());assertEquals(first.getContentAsString(),replay.getContentAsString());
  assertEquals(20,jdbc.queryForObject("select attempts from identity_rates where id=?",Integer.class,rateId));
  var changed=new HashMap<>(r);changed.put("termsVersions",Map.of("SERVICE","old","PRIVACY","old"));
  assertEquals("IDEMPOTENCY_KEY_CONFLICT",call(body(post("/api/v2/auth/register").header("Idempotency-Key",k),changed),409).path("code").asText());
  var fresh=mvc.perform(body(post("/api/v2/auth/register").header("Idempotency-Key",key()),r).with(q->{q.setRemoteAddr(ip);return q;})).andReturn().getResponse();assertEquals(429,fresh.getStatus());
  // Existing v6 receipts remain replayable after upgrading to v6.1.
  String legacy=crypto.lookup("registration.request",json.writeValueAsString(List.of(username,PASSWORD,"김시연",IdentityService.TERMS.get("SERVICE"),grant)));
  jdbc.update("update registration_receipts set request_hash=? where id=?",legacy,k);
  assertEquals(json.readTree(first.getContentAsString()),call(body(post("/api/v2/auth/register").header("Idempotency-Key",k),r),201));
 }
 @Test void registrationAuditLogsSafeSuccessReplayFailureAndIgnoresForwardedIp()throws Exception{
  Logger logger=(Logger)LoggerFactory.getLogger("BANK_REGISTRATION_AUDIT");var appender=new ListAppender<ILoggingEvent>();appender.start();logger.addAppender(appender);
  try{
   String phone=phone(),grant=contact("REGISTER","SMS",phone,null),username="audit"+IDS.incrementAndGet(),k=key();var r=signup(username,grant);
   var first=mvc.perform(body(post("/api/v2/auth/register").header("Idempotency-Key",k).header("X-Forwarded-For","1.2.3.4"),r).with(q->{q.setRemoteAddr("192.0.2.10");return q;})).andReturn().getResponse();assertEquals(201,first.getStatus());
   call(body(post("/api/v2/auth/register").header("Idempotency-Key",k),r),201);
   var bad=new HashMap<>(r);bad.put("username","auditbad"+IDS.incrementAndGet());
   call(body(post("/api/v2/auth/register").header("Idempotency-Key",k),bad),409);
   call(post("/api/v2/auth/register").contentType("application/json").content("{"),400);
   assertEquals(4,appender.list.size());var success=json.readTree(appender.list.get(0).getFormattedMessage());var replay=json.readTree(appender.list.get(1).getFormattedMessage());
   assertEquals("SUCCESS",success.path("outcome").asText());assertEquals("192.0.2.10",success.path("sourceIp").asText());assertEquals("registration",success.path("event").asText());
   assertEquals(json.readTree(first.getContentAsString()).path("customerId"),success.path("customerId"));assertTrue(success.path("reasonCode").isNull());
   assertEquals("REPLAY",replay.path("outcome").asText());assertEquals(success.path("phoneCorrelationId"),replay.path("phoneCorrelationId"));
   assertEquals(crypto.lookup("audit.registration.phone",IdentityService.normalize("SMS",phone)),success.path("phoneCorrelationId").asText());
   assertEquals("IDEMPOTENCY_KEY_CONFLICT",json.readTree(appender.list.get(2).getFormattedMessage()).path("reasonCode").asText());
   assertEquals("FAILURE",json.readTree(appender.list.get(3).getFormattedMessage()).path("outcome").asText());
   for(var event:appender.list)for(String secret:List.of(phone,username,PASSWORD,grant,"김시연"))assertFalse(event.getFormattedMessage().contains(secret));
  }finally{logger.detachAppender(appender);appender.stop();}
 }
}
