package com.club.bank;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.junit.jupiter.api.Test;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
@SpringBootTest @AutoConfigureMockMvc class VerificationDisabledTest {
 @Autowired MockMvc mvc;
 @Test void demoInboxAndDeliveryAreUnavailableInDefaultProfile()throws Exception{
  mvc.perform(post("/api/v2/demo/inbox").contentType("application/json").content("{}" )).andExpect(status().isNotFound());
  mvc.perform(post("/api/v2/contact-challenges").contentType("application/json").content("{\"purpose\":\"REGISTER\",\"channel\":\"EMAIL\",\"contact\":\"test@example.com\"}")).andExpect(status().isServiceUnavailable());
 }
}
