package com.club.bank;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import java.util.LinkedHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.filter.OncePerRequestFilter;

/** One safe JSON event per registration HTTP request, with success only after commit. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
class RegistrationAudit extends OncePerRequestFilter {
 private static final Logger LOG=LoggerFactory.getLogger("BANK_REGISTRATION_AUDIT");
 private static final ThreadLocal<Context> ACTIVE=new ThreadLocal<>();
 private static class Context {String outcome,reason,customer,phone;}
 private final FieldCrypto crypto;
 private final ObjectMapper json;
 RegistrationAudit(FieldCrypto crypto,ObjectMapper json){this.crypto=crypto;this.json=json;}
 static void failure(String reason){var c=ACTIVE.get();if(c!=null)c.reason=reason;}
 void identify(ContactChallenge challenge){
  var c=ACTIVE.get();if(c!=null&&"SMS".equals(challenge.channel))
   c.phone=crypto.lookup("audit.registration.phone",crypto.decrypt("contact_challenges.contact",challenge.id,challenge.contactEncrypted));
 }
 void identify(BankUser user){
  var c=ACTIVE.get();if(c!=null&&user.phoneEncrypted!=null)
   c.phone=crypto.lookup("audit.registration.phone",crypto.decrypt("bank_users.phone",user.publicId,user.phoneEncrypted));
 }
 void afterCommit(String outcome,String customer){
  var c=ACTIVE.get();if(c==null)return;
  if(!TransactionSynchronizationManager.isSynchronizationActive())throw new IllegalStateException("Registration audit requires a transaction");
  TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization(){
   @Override public void afterCommit(){c.outcome=outcome;c.customer=customer;}
  });
 }
 @Override protected boolean shouldNotFilter(HttpServletRequest request){
  return !"POST".equals(request.getMethod())||!request.getRequestURI().equals(request.getContextPath()+"/api/v2/auth/register");
 }
 @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws ServletException,IOException{
  Context c=new Context();ACTIVE.set(c);
  try{chain.doFilter(request,response);}
  catch(IOException|ServletException|RuntimeException ex){c.reason="INTERNAL_ERROR";throw ex;}
  finally{
   ACTIVE.remove();
   var event=new LinkedHashMap<String,Object>();event.put("event","registration");event.put("timestamp",Instant.now().toString());
   event.put("outcome",c.outcome==null?"FAILURE":c.outcome);
   event.put("reasonCode",c.outcome!=null?null:c.reason!=null?c.reason:response.getStatus()>=500?"INTERNAL_ERROR":"REQUEST_ERROR");
   event.put("customerId",c.customer);event.put("phoneCorrelationId",c.phone);
   // Direct peer only. Never accept a client-supplied X-Forwarded-For as an audit identity.
   event.put("sourceIp",request.getRemoteAddr());
   LOG.info(json.writeValueAsString(event));
  }
 }
}
