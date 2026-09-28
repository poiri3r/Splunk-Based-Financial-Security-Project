package com.club.bank;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@SpringBootTest @AutoConfigureMockMvc
class FrontendContractIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired TokenRepo tokens;
    @Autowired UserRepo users;

    record Customer(String username, String token, String account) {}
    JsonNode call(MockHttpServletRequestBuilder request, int status) throws Exception {
        var res = mvc.perform(request).andReturn().getResponse();
        assertEquals(status, res.getStatus(), res.getContentAsString());
        if (res.getContentAsByteArray().length == 0) return null;
        assertTrue(res.getContentType().startsWith("application/json"));
        return json.readTree(res.getContentAsByteArray());
    }
    MockHttpServletRequestBuilder body(String path, Object value) throws Exception {
        return post(path).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(value));
    }
    void error(MockHttpServletRequestBuilder request, int status, String code) throws Exception {
        var res=call(request,status);
        assertEquals(code,res.path("code").asText());
        assertTrue(res.path("message").isTextual());
        assertFalse(res.path("message").asText().isBlank());
    }
    Customer customer() throws Exception {
        String name="u"+UUID.randomUUID().toString().replace("-", "").substring(0,20);
        var credentials=Map.of("username",name,"password","LongPassword123!");
        call(body("/api/auth/register",credentials),201);
        var login=call(body("/api/auth/login",credentials),200);
        assertTrue(login.path("expiresIn").isIntegralNumber());
        assertEquals(28800,login.path("expiresIn").asLong());
        String token=login.path("token").asText();
        String number=call(post("/api/accounts").header("Authorization","Bearer "+token),201).path("number").asText();
        assertTrue(number.matches("2[0-9]{15}"));
        return new Customer(name,token,number);
    }
    MockHttpServletRequestBuilder deposit(Customer c, String key, String amount) throws Exception {
        var req=body("/api/deposits",Map.of("accountNumber",c.account(),"amount",new BigDecimal(amount)))
                .header("Authorization","Bearer "+c.token());
        return key==null?req:req.header("Idempotency-Key",key);
    }
    MockHttpServletRequestBuilder transfer(Customer c, String to, String key, String amount) throws Exception {
        return body("/api/transfers",Map.of("fromAccount",c.account(),"toAccount",to,"amount",new BigDecimal(amount)))
                .header("Authorization","Bearer "+c.token()).header("Idempotency-Key",key);
    }
    String key() { return UUID.randomUUID().toString(); }

    @Test void missingMalformedUnknownAndExpiredTokenAreJson401() throws Exception {
        error(get("/api/accounts"),401,"UNAUTHORIZED");
        for(String header:new String[]{"Basic abc","Bearer ","Bearer invalid","Bearer altered-token"})
            error(get("/api/accounts").header("Authorization",header),401,"UNAUTHORIZED");
        Customer c=customer();
        String expired="expired-"+key();
        tokens.saveAndFlush(new AuthToken(SecurityConfig.hash(expired),users.findByUsername(c.username()).orElseThrow(),Instant.now().minusSeconds(1)));
        error(get("/api/accounts").header("Authorization","Bearer "+expired),401,"UNAUTHORIZED");
        error(body("/api/auth/login",Map.of("username",c.username(),"password","incorrect")),401,"UNAUTHORIZED");
        error(body("/api/auth/login",Map.of("username","missing_"+key(),"password","incorrect")),401,"UNAUTHORIZED");
    }
    @Test void registrationValidationAndMalformedJsonHaveStableCodes() throws Exception {
        var invalid=call(body("/api/auth/register",Map.of("username","!","password","LongPassword123!")),400);
        assertEquals("INVALID_INPUT",invalid.path("code").asText());
        assertEquals("username",invalid.path("field").asText());
        Customer c=customer();
        error(body("/api/auth/register",Map.of("username",c.username(),"password","LongPassword123!")),409,"DUPLICATE_USERNAME");
        error(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{"),400,"INVALID_INPUT");
    }
    @Test void moneyErrorsAreDistinctAndOtherOwnersCannotQuery() throws Exception {
        Customer a=customer(),b=customer();
        error(deposit(a,null,"10"),400,"IDEMPOTENCY_KEY_INVALID");
        error(deposit(a,"bad-key","10"),400,"IDEMPOTENCY_KEY_INVALID");
        error(deposit(a,key(),"0"),400,"INVALID_INPUT");
        error(deposit(a,key(),"0.001"),400,"INVALID_INPUT");
        error(transfer(a,a.account(),key(),"1"),400,"SAME_ACCOUNT");
        error(transfer(a,b.account(),key(),"1"),409,"INSUFFICIENT_BALANCE");
        error(transfer(a,"not-found",key(),"1"),404,"ACCOUNT_NOT_FOUND");
        for(String suffix:new String[]{"balance","transactions"})
            error(get("/api/accounts/"+b.account()+"/"+suffix).header("Authorization","Bearer "+a.token()),404,"ACCOUNT_NOT_FOUND");
        error(body("/api/deposits",Map.of("accountNumber",b.account(),"amount",1)).header("Authorization","Bearer "+a.token()).header("Idempotency-Key",key()),404,"ACCOUNT_NOT_FOUND");
        call(deposit(b,key(),"99999999999999999.99"),200);
        error(deposit(b,key(),"0.01"),409,"BALANCE_LIMIT_EXCEEDED");
        call(deposit(a,key(),"1"),200);
        error(transfer(a,b.account(),key(),"1"),409,"BALANCE_LIMIT_EXCEEDED");
        assertEquals(0,new BigDecimal("1").compareTo(call(get("/api/accounts/"+a.account()+"/balance").header("Authorization","Bearer "+a.token()),200).path("balance").decimalValue()));
    }
    @Test void keyScopeAndNumericNormalizationMatchFrontendContract() throws Exception {
        Customer a=customer(),b=customer();
        String shared=key();
        String result=call(deposit(a,shared,"10000"),200).path("depositId").asText();
        assertEquals(result,call(deposit(a,shared,"10000.0"),200).path("depositId").asText());
        assertNotEquals(result,call(deposit(b,shared,"10000"),200).path("depositId").asText());
        error(deposit(a,shared,"10001"),409,"IDEMPOTENCY_KEY_CONFLICT");
        error(transfer(a,b.account(),shared,"1"),409,"IDEMPOTENCY_KEY_CONFLICT");
        String failedKey=key();
        error(transfer(a,b.account(),failedKey,"10001"),409,"INSUFFICIENT_BALANCE");
        call(deposit(a,key(),"1"),200);
        call(transfer(a,b.account(),failedKey,"10001"),200);
        assertEquals(0,call(get("/api/accounts/"+a.account()+"/balance").header("Authorization","Bearer "+a.token()),200).path("balance").decimalValue().compareTo(BigDecimal.ZERO));
    }
    @Test void healthIsOutsideApiPrefix() throws Exception {
        assertEquals("ok",call(get("/health"),200).path("status").asText());
        Customer c=customer();
        error(get("/api/health").header("Authorization","Bearer "+c.token()),404,"NOT_FOUND");
    }
}
