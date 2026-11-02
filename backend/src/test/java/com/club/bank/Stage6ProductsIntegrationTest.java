package com.club.bank;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.*;
import java.math.BigDecimal;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@SpringBootTest(properties="bank.demo-inbox-key=test-only-demo-inbox-secret-32-characters") @AutoConfigureMockMvc
@org.springframework.test.context.ActiveProfiles({"demo","demo-verification"})
class Stage6ProductsIntegrationTest {
    @Autowired MockMvc mvc;@Autowired ObjectMapper json;@Autowired JdbcTemplate jdbc;@Autowired FieldCrypto crypto;
    record Customer(String name,String token,String id,String number) {}
    String key(){return UUID.randomUUID().toString();}
    JsonNode call(MockHttpServletRequestBuilder r,int expected)throws Exception {
        var res=mvc.perform(r).andReturn().getResponse();assertEquals(expected,res.getStatus(),res.getContentAsString());
        return res.getContentAsByteArray().length==0?null:json.readTree(res.getContentAsByteArray());
    }
    MockHttpServletRequestBuilder body(MockHttpServletRequestBuilder r,Object value)throws Exception{return r.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(value));}
    MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder r,Customer c){return r.header("Authorization","Bearer "+c.token());}
    Customer customer()throws Exception{
        String name="t"+key().replace("-","").substring(0,15);var cred=Map.of("username",name,"password","LongPassword123!","pin","4826");
        var helper=new V6Support();helper.mvc=mvc;helper.json=json;helper.jdbc=jdbc;helper.crypto=crypto;
        String phone=helper.phone(),grant=helper.contact("REGISTER","SMS",phone,null);
        helper.call(helper.body(post("/api/v2/auth/register").header("Idempotency-Key",key()),helper.signup(name,grant)),201);
        String token=helper.login(name,V6Support.PASSWORD);
        var a=helper.call(helper.body(post("/api/v2/accounts").header("Authorization","Bearer "+token).header("Idempotency-Key",key()),Map.of("pin",V6Support.PIN,"termsVersion","MOCK-CHECKING-2026-v1")),201);
        return new Customer(name,token,a.path("accountId").asText(),a.path("number").asText());
    }
    void deposit(Customer c,String amount)throws Exception{call(auth(body(post("/api/v2/demo/deposits"),Map.of("accountNumber",c.number(),"amount",amount)),c).header("Idempotency-Key",key()),200);}
    Map<String,Object> previewBody(Customer a,Customer b,Object amount){return Map.of("fromAccountId",a.id(),"bankCode","LOCAL","toAccountNumber",b.number(),"amount",amount,"memo","점심 정산");}
    JsonNode preview(Customer a,Customer b,String amount)throws Exception{return call(auth(body(post("/api/v2/transfers/previews"),previewBody(a,b,amount)),a),201);}
    String grant(Customer a,String id)throws Exception{return call(auth(body(post("/api/v2/auth/step-up"),Map.of("pin","4826","purpose","TRANSFER","targetId",id)),a),200).path("actionToken").asText();}
    MockHttpServletRequestBuilder execute(Customer a,String p,String token,String k)throws Exception{return auth(body(post("/api/v2/transfers"),Map.of("previewId",p,"actionToken",token)),a).header("Idempotency-Key",k);}
    String balance(Customer a)throws Exception{return call(auth(get("/api/v2/accounts/"+a.id()),a),200).path("balance").asText();}
    void legacy(Customer a,Customer b,String amount)throws Exception{call(auth(body(post("/api/transfers"),Map.of("fromAccount",a.number(),"toAccount",b.number(),"amount",amount)),a).header("Idempotency-Key",key()),200);}

 Map<String,Object> joinBody(Customer a,String product,String amount){return Map.of("sourceAccountId",a.id(),"productId",product,"amount",amount,"termsVersion",SavingsService.TERMS,"pin","4826");}
 JsonNode join(Customer a,String product,String amount)throws Exception{return call(auth(body(post("/api/v2/savings"),joinBody(a,product,amount)),a).header("Idempotency-Key",key()),200);}
 Map<String,Object> closeBody(Customer a,JsonNode q){return Map.of("targetAccountId",a.id(),"version",q.path("version").asLong(),"quoteDate",q.path("quoteDate").asText(),"quoteToken",q.path("quoteToken").asText(),"password","LongPassword123!","pin","4826");}
 JsonNode quote(Customer a,String id)throws Exception{return call(auth(get("/api/v2/savings/"+id+"/closure-quote").param("targetAccountId",a.id()),a),200);}
 void age(String id,int months){
  var start=AccountPolicy.today().minusMonths(months);
  jdbc.update("UPDATE savings_contracts SET opened_on=?,maturity_on=? WHERE id=?",start,start.plusMonths(12),id);
  jdbc.update("UPDATE savings_payments SET paid_on=? WHERE contract_id=?",start,id);
 }
 @Test void joinCloseReplayOwnershipAndEncryptedReceipts()throws Exception{
  var a=customer();var b=customer();deposit(a,"50000");String k=key();var request=joinBody(a,"MOCK-DEPOSIT-12","10000");
  var joined=call(auth(body(post("/api/v2/savings"),request),a).header("Idempotency-Key",k),200);String id=joined.path("subscriptionId").asText();
  assertEquals("40000.00",balance(a));assertEquals(joined,call(auth(body(post("/api/v2/savings"),request),a).header("Idempotency-Key",k),200));
  call(auth(get("/api/v2/savings/"+id),b),404);
  var q=quote(a,id);assertEquals("0.00",q.path("interest").asText());assertEquals("EARLY",q.path("closureType").asText());
  String ck=key();var cr=closeBody(a,q);var closed=call(auth(body(post("/api/v2/savings/"+id+"/closure"),cr),a).header("Idempotency-Key",ck),200);
  assertEquals("50000.00",balance(a));assertEquals(closed,call(auth(body(post("/api/v2/savings/"+id+"/closure"),cr),a).header("Idempotency-Key",ck),200));
  call(auth(body(post("/api/v2/savings/"+id+"/closure"),cr),a).header("Idempotency-Key",key()),409);
  assertEquals(joined,call(auth(body(post("/api/v2/savings"),request),a).header("Idempotency-Key",k),200));
  assertTrue(jdbc.queryForObject("SELECT result_encrypted FROM savings_receipts WHERE id=(SELECT result_id FROM idempotency_records WHERE request_key=?)",String.class,k).startsWith("v1:"));
  assertEquals("CLOSED",call(auth(get("/api/v2/accounts/"+joined.path("accountId").asText()),a),200).path("status").asText());
 }
 @Test void savingsMonthlyPaymentAndMatureClosure()throws Exception{
  var a=customer();deposit(a,"20000");var joined=join(a,"MOCK-SAVINGS-12","1000");String id=joined.path("subscriptionId").asText();
  var pay=Map.of("sourceAccountId",a.id(),"version",0,"password","LongPassword123!","pin","4826");
  assertEquals("PERIOD_ALREADY_PAID",call(auth(body(post("/api/v2/savings/"+id+"/payments"),pay),a).header("Idempotency-Key",key()),409).path("code").asText());
  age(id,1);String pk=key();var result=call(auth(body(post("/api/v2/savings/"+id+"/payments"),pay),a).header("Idempotency-Key",pk),200);
  assertEquals("2000.00",result.path("principal").asText());assertEquals(result,call(auth(body(post("/api/v2/savings/"+id+"/payments"),pay),a).header("Idempotency-Key",pk),200));
  assertEquals(2,result.path("payments").size());assertEquals("18000.00",balance(a));
  age(id,13);var q=quote(a,id);assertEquals("MATURE",q.path("closureType").asText());assertTrue(new BigDecimal(q.path("interest").asText()).signum()>0);
  var pay2=Map.of("sourceAccountId",a.id(),"version",1,"password","LongPassword123!","pin","4826");
  assertEquals("PAYMENT_PERIOD_CLOSED",call(auth(body(post("/api/v2/savings/"+id+"/payments"),pay2),a).header("Idempotency-Key",key()),409).path("code").asText());
  call(auth(body(post("/api/v2/savings/"+id+"/closure"),closeBody(a,q)),a).header("Idempotency-Key",key()),200);
  assertEquals(new BigDecimal("20000").add(new BigDecimal(q.path("interest").asText())),new BigDecimal(balance(a)));
 }
 @Test void ordinaryApisCannotBypassProductRules()throws Exception{
  var a=customer();deposit(a,"30000");var j=join(a,"MOCK-DEPOSIT-12","10000");String number=j.path("accountNumber").asText(),id=j.path("accountId").asText();
  for(var req:List.of(Map.of("fromAccount",a.number(),"toAccount",number,"amount","1"),Map.of("fromAccount",number,"toAccount",a.number(),"amount","1")))
   assertEquals("FORBIDDEN",call(auth(body(post("/api/transfers"),req),a).header("Idempotency-Key",key()),403).path("code").asText());
  call(auth(body(post("/api/v2/demo/deposits"),Map.of("accountNumber",number,"amount","1")),a).header("Idempotency-Key",key()),409);
  call(auth(body(post("/api/v2/auth/step-up"),Map.of("purpose","DEBIT_SETTING","targetId",id,"password","LongPassword123!","pin","4826","changes",Map.of("version",0,"enabled",true))),a),409);
  assertEquals("0.00",call(auth(get("/api/v2/accounts/"+id),a),200).path("availableBalance").asText());
 }
 @Test void inputTermsPinLimitsAndIdempotencyConflicts()throws Exception{
  var a=customer();deposit(a,"30000");var r=new HashMap<String,Object>(joinBody(a,"MOCK-DEPOSIT-12","10000"));
  r.put("amount",10000);call(auth(body(post("/api/v2/savings"),r),a).header("Idempotency-Key",key()),400);
  r.put("amount","1e4");call(auth(body(post("/api/v2/savings"),r),a).header("Idempotency-Key",key()),400);
  r.put("amount","10000");r.put("termsVersion","old");call(auth(body(post("/api/v2/savings"),r),a).header("Idempotency-Key",key()),409);
  r.put("termsVersion",SavingsService.TERMS);r.put("pin","7391");call(auth(body(post("/api/v2/savings"),r),a).header("Idempotency-Key",key()),403);
  r.put("pin","4826");String k=key();call(auth(body(post("/api/v2/savings"),r),a).header("Idempotency-Key",k),200);
  r.put("amount","20000");call(auth(body(post("/api/v2/savings"),r),a).header("Idempotency-Key",k),409);
  jdbc.update("UPDATE bank_users SET per_transfer_limit=100 WHERE id=(SELECT owner_id FROM accounts WHERE public_id=?)",a.id());
  call(auth(body(post("/api/v2/savings"),r),a).header("Idempotency-Key",key()),409);assertEquals("20000.00",balance(a));
 }
 @Test void closureQuoteBoundToTargetDayAndVersion()throws Exception{
  var a=customer();deposit(a,"20000");var j=join(a,"MOCK-DEPOSIT-12","10000");String id=j.path("subscriptionId").asText();var q=quote(a,id);
  var r=new HashMap<String,Object>(closeBody(a,q));r.put("quoteDate","2000-01-01");call(auth(body(post("/api/v2/savings/"+id+"/closure"),r),a).header("Idempotency-Key",key()),409);
  r.put("quoteDate",q.path("quoteDate").asText());r.put("quoteToken","tampered");call(auth(body(post("/api/v2/savings/"+id+"/closure"),r),a).header("Idempotency-Key",key()),409);
  r.put("quoteToken",q.path("quoteToken").asText());r.put("version",5);call(auth(body(post("/api/v2/savings/"+id+"/closure"),r),a).header("Idempotency-Key",key()),409);
  var other=customer();call(auth(get("/api/v2/savings/"+id+"/closure-quote").param("targetAccountId",other.id()),a),404);
  assertEquals("10000.00",balance(a));
 }
 @Test void failedLedgerWriteRollsBackAllMoneyAndRetryWorks()throws Exception{
  var a=customer();deposit(a,"20000");String k=key();var r=joinBody(a,"MOCK-DEPOSIT-12","10000");
  Long owner=jdbc.queryForObject("SELECT id FROM accounts WHERE public_id=?",Long.class,a.id());
  jdbc.execute("ALTER TABLE ledger_entries ADD CONSTRAINT reject_test_owner CHECK (account_id <> "+owner+" OR amount >= 0)");
  try{call(auth(body(post("/api/v2/savings"),r),a).header("Idempotency-Key",k),500);assertEquals("20000.00",balance(a));assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM idempotency_records WHERE request_key=?",Integer.class,k));}
  finally{jdbc.execute("ALTER TABLE ledger_entries DROP CONSTRAINT reject_test_owner");}
  call(auth(body(post("/api/v2/savings"),r),a).header("Idempotency-Key",k),200);assertEquals("10000.00",balance(a));
 }
 @Test void concurrentSameKeyCreatesOnlyOneSubscription()throws Exception{
  var a=customer();deposit(a,"30000");String k=key();var r=joinBody(a,"MOCK-DEPOSIT-12","10000");var pool=Executors.newFixedThreadPool(2);
  try{var f1=pool.submit(()->call(auth(body(post("/api/v2/savings"),r),a).header("Idempotency-Key",k),200));var f2=pool.submit(()->call(auth(body(post("/api/v2/savings"),r),a).header("Idempotency-Key",k),200));assertEquals(f1.get(20,TimeUnit.SECONDS),f2.get(20,TimeUnit.SECONDS));assertEquals("20000.00",balance(a));}finally{pool.shutdownNow();}
 }
 @Test void pinFailurePersistsWithoutCreatingContract()throws Exception{
  var a=customer();deposit(a,"20000");var encoder=new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder();
  jdbc.update("UPDATE accounts SET pin_hash=? WHERE public_id=?",encoder.encode("1234"),a.id());var r=new HashMap<String,Object>(joinBody(a,"MOCK-DEPOSIT-12","10000"));r.put("pin","9999");
  for(int i=0;i<4;i++)call(auth(body(post("/api/v2/savings"),r),a).header("Idempotency-Key",key()),i==3?423:403);
  assertEquals(4,jdbc.queryForObject("SELECT pin_failures FROM accounts WHERE public_id=?",Integer.class,a.id()));assertEquals("20000.00",balance(a));
 }
 @Test void closureFailureRollsBackThenConcurrentClosuresPayOnce()throws Exception{
  var a=customer();deposit(a,"20000");var j=join(a,"MOCK-DEPOSIT-12","10000");String id=j.path("subscriptionId").asText();age(id,6);var q=quote(a,id);var r=closeBody(a,q);
  Long account=jdbc.queryForObject("SELECT id FROM accounts WHERE public_id=?",Long.class,j.path("accountId").asText());
  jdbc.execute("ALTER TABLE ledger_entries ADD CONSTRAINT reject_test_close CHECK (account_id <> "+account+" OR amount >= 0)");
  try{call(auth(body(post("/api/v2/savings/"+id+"/closure"),r),a).header("Idempotency-Key",key()),500);assertEquals("10000.00",balance(a));assertEquals("ACTIVE",call(auth(get("/api/v2/savings/"+id),a),200).path("status").asText());}
  finally{jdbc.execute("ALTER TABLE ledger_entries DROP CONSTRAINT reject_test_close");}
  // Return of own principal is possible even when daily/per-transfer limits are zero.
  jdbc.update("UPDATE bank_users SET per_transfer_limit=0,daily_limit=0 WHERE id=(SELECT owner_id FROM accounts WHERE public_id=?)",a.id());
  var pool=Executors.newFixedThreadPool(2);
  try{Callable<Integer> task=()->mvc.perform(auth(body(post("/api/v2/savings/"+id+"/closure"),r),a).header("Idempotency-Key",key())).andReturn().getResponse().getStatus();var x=pool.submit(task);var y=pool.submit(task);var statuses=new ArrayList<>(List.of(x.get(20,TimeUnit.SECONDS),y.get(20,TimeUnit.SECONDS)));Collections.sort(statuses);assertEquals(List.of(200,409),statuses);
  assertEquals(new BigDecimal("20000.00").add(new BigDecimal(q.path("interest").asText())),new BigDecimal(balance(a)));}finally{pool.shutdownNow();}
 }
}
