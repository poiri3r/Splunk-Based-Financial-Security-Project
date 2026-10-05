package com.club.bank;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@SpringBootTest(properties="bank.demo-inbox-key=test-only-demo-inbox-secret-32-characters")
@AutoConfigureMockMvc @ActiveProfiles({"demo","demo-verification"})
class V62PinOnlyIntegrationTest extends V6Support {
 Map<String,Object> joinBody(Customer c,String product){return new HashMap<>(Map.of("productId",product,"sourceAccountId",c.id(),"amount","10000.00","termsVersion",SavingsService.TERMS,"pin",PIN));}
 @Test void pinOnlyTransferExecutesAndReplaysAfterPinLock()throws Exception{
  var a=customer();var b=customer();deposit(a,"50000.00");String p=preview(a,b,"1000.00").path("previewId").asText();
  var request=new HashMap<String,Object>(Map.of("purpose","TRANSFER","targetId",p,"pin",PIN));
  var grant=call(auth(body(post("/api/v2/auth/step-up"),request),a),200);
  assertEquals("ACCOUNT_PIN",grant.path("authenticationMethod").asText());
  String token=grant.path("actionToken").asText(),k=key();var result=call(execute(a,p,token,k),200);
  String other=preview(a,b,"1000.00").path("previewId").asText();
  request.put("targetId",other);request.put("pin","7391");
  for(int i=1;i<=4;i++)assertEquals(i==4?"PIN_LOCKED":"PIN_INVALID",call(auth(body(post("/api/v2/auth/step-up"),request),a),i==4?423:403).path("code").asText());
  request.put("pin",PIN);call(auth(body(post("/api/v2/auth/step-up"),request),a),423);
  assertEquals(result,call(execute(a,p,token,k),200));assertEquals("49000.00",balance(a));assertEquals("1000.00",balance(b));
  me(a);
 }
 @Test void transferRequiresPinAndPreviewOwnerAndRetainsRequestBudget()throws Exception{
  var a=customer();var b=customer();deposit(a,"50000.00");String p=preview(a,b,"1.00").path("previewId").asText();
  var r=new HashMap<String,Object>(Map.of("purpose","TRANSFER","targetId",p));
  assertEquals("ACCOUNT_PIN_REQUIRED",call(auth(body(post("/api/v2/auth/step-up"),r),a),403).path("code").asText());
  r.put("pin","123");call(auth(body(post("/api/v2/auth/step-up"),r),a),400);
  r.put("pin",PIN);call(auth(body(post("/api/v2/auth/step-up"),r),b),404);
  r.put("password","ignored-old-client-password");
  for(int i=0;i<29;i++)call(auth(body(post("/api/v2/auth/step-up"),r),a),200);
  var res=mvc.perform(auth(body(post("/api/v2/auth/step-up"),r),a)).andReturn().getResponse();
  assertEquals(429,res.getStatus());assertNotNull(res.getHeader("Retry-After"));
 }
 @Test void bothProductsJoinWithoutPasswordAndReplayWithoutDuplicateDebit()throws Exception{
  var a=customer();deposit(a,"50000.00");
  for(String product:List.of("MOCK-DEPOSIT-12","MOCK-SAVINGS-12")){
   var r=joinBody(a,product);String k=key();
   var joined=call(auth(body(post("/api/v2/savings").header("Idempotency-Key",k),r),a),200);
   assertEquals(joined,call(auth(body(post("/api/v2/savings").header("Idempotency-Key",k),r),a),200));
   var changed=new HashMap<>(r);changed.put("amount","20000.00");
   assertEquals("IDEMPOTENCY_KEY_CONFLICT",call(auth(body(post("/api/v2/savings").header("Idempotency-Key",k),changed),a),409).path("code").asText());
  }
  assertEquals("30000.00",balance(a));
 }
 @Test void joinPinFailureDoesNotCreateContractDebitOrReceiptAndLocksAcrossFlows()throws Exception{
  var a=customer();var b=customer();deposit(a,"50000.00");var r=joinBody(a,"MOCK-DEPOSIT-12");String k=key();
  r.remove("pin");assertEquals("ACCOUNT_PIN_REQUIRED",call(auth(body(post("/api/v2/savings").header("Idempotency-Key",k),r),a),403).path("code").asText());
  r.put("pin","123");call(auth(body(post("/api/v2/savings").header("Idempotency-Key",k),r),a),400);
  String p=preview(a,b,"1.00").path("previewId").asText();
  r.put("pin","7391");
  for(int i=0;i<3;i++)call(auth(body(post("/api/v2/savings").header("Idempotency-Key",k),r),a),403);
  call(auth(body(post("/api/v2/auth/step-up"),Map.of("purpose","TRANSFER","targetId",p,"pin","7391")),a),423);
  r.put("pin",PIN);call(auth(body(post("/api/v2/savings").header("Idempotency-Key",k),r),a),423);
  assertEquals("50000.00",balance(a));assertEquals(0,call(auth(get("/api/v2/savings"),a),200).path("items").size());
  assertEquals(0,jdbc.queryForObject("select count(*) from idempotency_records where request_key=?",Integer.class,k));
 }
 @Test void settingsStillRequirePasswordAndSavingsOwnershipIsEnforced()throws Exception{
  var a=customer();var b=customer();deposit(a,"50000.00");
  var r=Map.of("purpose","DEBIT_SETTING","targetId",a.id(),"changes",Map.of("version",0,"enabled",false),"pin",PIN);
  assertEquals("password",call(auth(body(post("/api/v2/auth/step-up"),r),a),400).path("field").asText());
  var join=joinBody(a,"MOCK-DEPOSIT-12");join.put("sourceAccountId",b.id());
  call(auth(body(post("/api/v2/savings").header("Idempotency-Key",key()),join),a),404);
  join.put("sourceAccountId",a.id());join.put("password","ignored-old-client-password");
  call(auth(body(post("/api/v2/savings").header("Idempotency-Key",key()),join),a),200);
 }
}
