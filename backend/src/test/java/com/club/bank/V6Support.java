package com.club.bank;
import com.fasterxml.jackson.databind.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

class V6Support {
 @Autowired MockMvc mvc;@Autowired ObjectMapper json;@Autowired JdbcTemplate jdbc;@Autowired FieldCrypto crypto;
 static final String PASSWORD="LongPassword123!",PIN="4826",INBOX="test-only-demo-inbox-secret-32-characters";
 static final AtomicLong IDS=new AtomicLong(80000000);
 record Customer(String username,String token,String id,String number,String phone){}
 String key(){return UUID.randomUUID().toString();}
 MockHttpServletRequestBuilder body(MockHttpServletRequestBuilder r,Object b)throws Exception{return r.contentType("application/json").content(json.writeValueAsBytes(b));}
 MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder r,Customer c){return r.header("Authorization","Bearer "+c.token());}
 JsonNode call(MockHttpServletRequestBuilder r,int status)throws Exception{
  var res=mvc.perform(r.with(req->{req.setRemoteAddr("test-"+IDS.incrementAndGet());return req;})).andReturn().getResponse();
  assertEquals(status,res.getStatus(),res.getContentAsString());return res.getContentAsByteArray().length==0?null:json.readTree(res.getContentAsByteArray());
 }
 String phone(){String p;do{p="010"+IDS.incrementAndGet();}while(p.contains(PIN));return p;}
 Map<String,Object> signup(String username,String grant){return Map.of("username",username,"password",PASSWORD,"name","김시연","termsVersions",IdentityService.TERMS,"contactGrant",grant);}
 String contact(String purpose,String channel,String contact,Customer c)throws Exception{
  var req=body(post("/api/v2/contact-challenges"),Map.of("purpose",purpose,"channel",channel,"contact",contact));
  var challenge=call(c==null?req:auth(req,c),202);
  String code=call(body(post("/api/v2/demo/inbox").header("X-Demo-Inbox-Key",INBOX),Map.of("challengeId",challenge.path("challengeId").asText(),"inboxToken",challenge.path("inboxToken").asText())),200).path("code").asText();
  var verify=body(post("/api/v2/contact-challenges/"+challenge.path("challengeId").asText()+"/verify"),Map.of("code",code));
  return call(c==null?verify:auth(verify,c),200).path("contactGrant").asText();
 }
 Customer customer()throws Exception{
  String name="u"+key().replace("-","").substring(0,15),phone=phone();
  String grant=contact("REGISTER","SMS",phone,null);
  call(body(post("/api/v2/auth/register").header("Idempotency-Key",key()),signup(name,grant)),201);
  String token=login(name,PASSWORD);var a=call(body(post("/api/v2/accounts").header("Authorization","Bearer "+token).header("Idempotency-Key",key()),Map.of("pin",PIN,"termsVersion","MOCK-CHECKING-2026-v1")),201);
  return new Customer(name,token,a.path("accountId").asText(),a.path("number").asText(),phone);
 }
 String login(String user,String pass)throws Exception{return call(body(post("/api/v2/auth/login"),Map.of("username",user,"password",pass)),200).path("token").asText();}
 Customer relogin(Customer c,String pass)throws Exception{return new Customer(c.username(),login(c.username(),pass),c.id(),c.number(),c.phone());}
 JsonNode deposit(Customer c,String amount)throws Exception{return call(auth(body(post("/api/v2/demo/deposits").header("Idempotency-Key",key()),Map.of("accountNumber",c.number(),"amount",amount)),c),200);}
 String balance(Customer c)throws Exception{return call(auth(get("/api/v2/accounts/"+c.id()),c),200).path("balance").asText();}
 JsonNode me(Customer c)throws Exception{return call(auth(get("/api/v2/auth/me"),c),200);}
 JsonNode preview(Customer a,Customer b,String amount)throws Exception{return call(auth(body(post("/api/v2/transfers/previews"),Map.of("fromAccountId",a.id(),"bankCode","LOCAL","toAccountNumber",b.number(),"amount",amount,"memo","회비")),a),201);}
 String approval(Customer c,String id,String pin)throws Exception{return call(auth(body(post("/api/v2/auth/step-up"),Map.of("purpose","TRANSFER","targetId",id,"pin",pin)),c),200).path("actionToken").asText();}
 MockHttpServletRequestBuilder execute(Customer c,String preview,String grant,String key)throws Exception{return auth(body(post("/api/v2/transfers").header("Idempotency-Key",key),Map.of("previewId",preview,"actionToken",grant)),c);}
 Map<String,Object> proof(Customer c,String purpose,String pin){return Map.of("purpose",purpose,"method","ACCOUNT","name","김시연","accountNumber",c.number(),"pin",pin);}
 String resetGrant(Customer c,String purpose)throws Exception{return call(body(post("/api/v2/recovery/verifications"),proof(c,purpose,PIN)),200).path("resetToken").asText();}
 long uid(Customer c){return jdbc.queryForObject("select id from bank_users where username_lookup=?",Long.class,crypto.lookup("bank_users.username",c.username()));}
}
