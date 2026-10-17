package com.club.bank;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.time.Instant;
import java.util.*;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Common audit envelope outside Spring Security; retains registration helper compatibility. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
class RegistrationAudit extends OncePerRequestFilter {
    private final FieldCrypto crypto;
    private final ObjectMapper json;
    private final AuditLogSink sink;
    RegistrationAudit(FieldCrypto crypto,ObjectMapper json,AuditLogSink sink){this.crypto=crypto;this.json=json;this.sink=sink;}
    static void failure(String reason){Audit.failure(reason);}
    void identify(ContactChallenge c){if("SMS".equals(c.channel))Audit.detail("phoneCorrelationId",crypto.lookup("audit.registration.phone",crypto.decrypt("contact_challenges.contact",c.id,c.contactEncrypted)));}
    void identify(BankUser u){if(u.phoneEncrypted!=null)Audit.detail("phoneCorrelationId",crypto.lookup("audit.registration.phone",crypto.decrypt("bank_users.phone",u.publicId,u.phoneEncrypted)));}
    void afterCommit(String outcome,String customer){Audit.complete(outcome,customer);}
    @Override protected boolean shouldNotFilter(HttpServletRequest r){return !r.getRequestURI().startsWith(r.getContextPath()+"/api/");}
    static String route(String method,String path) {
        String key=method+" "+path;
        return switch(key) {
            case "POST /api/v2/auth/register" -> "registration";
            case "POST /api/v2/auth/login" -> "login";
            case "POST /api/v2/auth/logout" -> "logout";
            case "POST /api/v2/auth/step-up" -> "authorization";
            case "POST /api/v2/transfers/previews" -> "transfer.preview";
            case "POST /api/v2/transfers" -> "transfer.execute";
            case "POST /api/v2/savings" -> "savings.join";
            case "POST /api/v2/recovery/verifications" -> "recovery.verify";
            case "POST /api/v2/recovery/password" -> "recovery.password";
            case "POST /api/v2/recovery/login-unlock" -> "recovery.login_unlock";
            case "POST /api/v2/me/recovery-codes" -> "recovery.codes.issue";
            case "PUT /api/v2/me/password" -> "password.change";
            case "PUT /api/v2/me/contact" -> "contact.change";
            case "PUT /api/v2/me/profile" -> "profile.change";
            case "PUT /api/v2/me/transfer-limits" -> "transfer_limits.change";
            case "POST /api/v2/contact-challenges" -> "contact.challenge";
            case "POST /api/v2/accounts" -> "account.open";
            case "POST /api/v2/demo/deposits" -> "demo.deposit";
            case "POST /api/v2/beneficiaries" -> "beneficiary.add";
            default -> dynamic(method,path);
        };
    }
    private static String dynamic(String method,String path) {
        if(method.equals("POST")&&path.matches("/api/v2/contact-challenges/[^/]+/verify"))return "contact.verify";
        if(method.equals("POST")&&path.matches("/api/v2/savings/[^/]+/payments"))return "savings.pay";
        if(method.equals("POST")&&path.matches("/api/v2/savings/[^/]+/closure"))return "savings.close";
        if(method.equals("GET")&&path.matches("/api/v2/savings/[^/]+/closure-quote"))return "savings.quote";
        if(method.equals("POST")&&path.matches("/api/v2/accounts/[^/]+/pin/reset"))return "pin.reset";
        if(method.equals("PUT")&&path.matches("/api/v2/accounts/[^/]+/pin"))return "pin.change";
        if(method.equals("PUT")&&path.matches("/api/v2/accounts/[^/]+/debit-setting"))return "account.debit_setting";
        if(method.equals("PATCH")&&path.matches("/api/v2/accounts/[^/]+/preferences"))return "account.preferences";
        if(path.matches("/api/v2/beneficiaries/[^/]+"))return switch(method){case "PATCH"->"beneficiary.update";case "DELETE"->"beneficiary.delete";default->null;};
        return null;
    }
    @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain)throws ServletException,IOException {
        var c=new Audit.Context(route(req.getMethod(),req.getRequestURI().substring(req.getContextPath().length())));
        Audit.ACTIVE.set(c);res.setHeader("X-Request-ID",c.requestId);
        boolean thrown=false;
        try{chain.doFilter(req,res);}
        catch(IOException|ServletException|RuntimeException ex){thrown=true;c.reason="INTERNAL_ERROR";throw ex;}
        finally {
            Audit.ACTIVE.remove();int status=thrown?500:res.getStatus();
            String reason=c.reason!=null?c.reason:switch(status){case 400->"INVALID_INPUT";case 401->"UNAUTHORIZED";case 403->"FORBIDDEN";case 429->"RATE_LIMITED";default->status>=500?"INTERNAL_ERROR":"REQUEST_ERROR";};
            if(c.event!=null){
                String outcome=c.outcome==null?"FAILURE":c.outcome;
                var row=envelope(c,req,status,c.event,"BUSINESS",outcome,c.outcome!=null?null:c.reason!=null?c.reason:c.rolledBack?"TRANSACTION_ROLLED_BACK":reason);
                if(c.event.startsWith("transfer.")||c.event.startsWith("savings."))
                    for(String field:List.of("transferId","amount","sourceAccountId","targetAccountId"))row.put(field,null);
                row.putAll(c.details);emit(row);
            }
            for(var fields:c.additional){var row=envelope(c,req,status,fields.get("event").toString(),"SECURITY","FAILURE",fields.get("reasonCode"));row.putAll(fields);emit(row);}
            if(status>=400){var row=envelope(c,req,status,"http.error","HTTP","FAILURE",reason);
                String retry=res.getHeader("Retry-After");if(retry!=null&&retry.matches("[0-9]{1,10}"))row.put("retryAfterSeconds",Long.parseLong(retry));emit(row);}
        }
    }
    private Map<String,Object> envelope(Audit.Context c,HttpServletRequest req,int status,String event,String type,String outcome,Object reason) {
        var row=new LinkedHashMap<String,Object>();row.put("schemaVersion",1);row.put("eventId",UUID.randomUUID().toString());row.put("timestamp",Instant.now().toString());
        row.put("event",event);row.put("eventType",type);row.put("outcome",outcome);row.put("reasonCode",reason);row.put("requestId",c.requestId);
        row.put("httpStatus",status);row.put("customerId",c.customer);row.put("sourceIp",req.getRemoteAddr());
        // Do not log URI, query, headers, raw body, exception messages or rejected values.
        return row;
    }
    private void emit(Map<String,Object> row){
        try{sink.write(json.writeValueAsString(row));}
        catch(Exception ex){LoggerFactory.getLogger(RegistrationAudit.class).error("AUDIT_SERIALIZATION_FAILED eventId={}",row.get("eventId"));}
    }
}
