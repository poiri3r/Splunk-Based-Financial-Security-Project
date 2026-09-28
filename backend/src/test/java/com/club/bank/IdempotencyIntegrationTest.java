package com.club.bank;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@SpringBootTest @AutoConfigureMockMvc class IdempotencyIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

    private JsonNode response(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,int status) throws Exception {
        var result=mvc.perform(request).andReturn().getResponse();
        assertEquals(status,result.getStatus(),result.getContentAsString());
        return result.getContentAsString().isBlank()?null:json.readTree(result.getContentAsString());
    }

    @Test void repeatedDepositAndTransferDoNotMoveMoneyTwice() throws Exception {
        String username="u"+UUID.randomUUID().toString().replace("-","").substring(0,12);
        String credential="{\"username\":\""+username+"\",\"password\":\"LongPassword123!\"}";
        response(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(credential),201);
        String token=response(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(credential),200).get("token").asText();
        String authorization="Bearer "+token;
        String first=response(post("/api/accounts").header("Authorization",authorization),201).get("number").asText();
        String second=response(post("/api/accounts").header("Authorization",authorization),201).get("number").asText();

        String deposit="{\"accountNumber\":\""+first+"\",\"amount\":100.00}";
        String dKey=UUID.randomUUID().toString();
        var dRequest=post("/api/deposits").header("Authorization",authorization).header("Idempotency-Key",dKey).contentType(MediaType.APPLICATION_JSON).content(deposit);
        String depositId=response(dRequest,200).get("depositId").asText();
        assertEquals(depositId,response(post("/api/deposits").header("Authorization",authorization).header("Idempotency-Key",dKey).contentType(MediaType.APPLICATION_JSON).content(deposit),200).get("depositId").asText());
        response(post("/api/deposits").header("Authorization",authorization).header("Idempotency-Key",dKey).contentType(MediaType.APPLICATION_JSON).content(deposit.replace("100.00","101.00")),409);
        response(post("/api/deposits").header("Authorization",authorization).contentType(MediaType.APPLICATION_JSON).content(deposit),400);

        String transfer="{\"fromAccount\":\""+first+"\",\"toAccount\":\""+second+"\",\"amount\":30.00}";
        String tKey=UUID.randomUUID().toString();
        String transferId=response(post("/api/transfers").header("Authorization",authorization).header("Idempotency-Key",tKey).contentType(MediaType.APPLICATION_JSON).content(transfer),200).get("transferId").asText();
        assertEquals(transferId,response(post("/api/transfers").header("Authorization",authorization).header("Idempotency-Key",tKey).contentType(MediaType.APPLICATION_JSON).content(transfer),200).get("transferId").asText());
        assertEquals(0,response(get("/api/accounts/"+first+"/balance").header("Authorization",authorization),200).get("balance").decimalValue().compareTo(new java.math.BigDecimal("70")));
        assertEquals(0,response(get("/api/accounts/"+second+"/balance").header("Authorization",authorization),200).get("balance").decimalValue().compareTo(new java.math.BigDecimal("30")));
        assertEquals(2,response(get("/api/accounts/"+first+"/transactions").header("Authorization",authorization),200).size());
        assertEquals(1,response(get("/api/accounts/"+second+"/transactions").header("Authorization",authorization),200).size());
    }
}
