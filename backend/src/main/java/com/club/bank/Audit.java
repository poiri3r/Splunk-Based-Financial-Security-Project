package com.club.bank;

import java.time.Instant;
import java.util.*;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Request-scoped audit metadata. Explicit allowlist: never serialize requests or entities. */
final class Audit {
    private Audit() {}
    static final ThreadLocal<Context> ACTIVE = new ThreadLocal<>();
    static final Set<String> FIELDS = Set.of("accountId","sourceAccountId","targetAccountId","transferId",
        "previewId","productId","subscriptionId","amount","principal","interest","tax","total",
        "interestTransferId","purpose","method","changedFields","targetId","channel","challengeId",
        "phoneCorrelationId","failureCount","lockState","retryAfterSeconds","perTransfer","daily");
    static class Context {
        String event, outcome, reason, customer;
        final String requestId = UUID.randomUUID().toString();
        final Map<String,Object> details = new LinkedHashMap<>();
        final List<Map<String,Object>> additional = new ArrayList<>();
        boolean rolledBack;
        Context(String event) { this.event=event; }
    }
    static void event(String event) { var c=ACTIVE.get(); if(c!=null)c.event=event; }
    static void customer(String publicId) { var c=ACTIVE.get(); if(c!=null)c.customer=publicId; }
    static void failure(String code) { var c=ACTIVE.get(); if(c!=null)c.reason=code; }
    static void detail(String key,Object value) {
        if(!FIELDS.contains(key))throw new IllegalArgumentException("Unsupported audit field");
        var c=ACTIVE.get(); if(c!=null)c.details.put(key,value);
    }
    static void success() { complete("SUCCESS",null); }
    static void replay() { complete("REPLAY",null); }
    static void complete(String outcome,String customer) {
        var c=ACTIVE.get(); if(c==null)return;
        if(!TransactionSynchronizationManager.isSynchronizationActive())throw new IllegalStateException("Audit success requires transaction");
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() { c.outcome=outcome; if(customer!=null)c.customer=customer; }
            @Override public void afterCompletion(int status) { if(status!=STATUS_COMMITTED)c.rolledBack=true; }
        });
    }
    /** Lock transitions / PIN failures that change persistent state appear only after commit. */
    static void security(String event,String reason,Account account,boolean mutation) {
        var c=ACTIVE.get();if(c==null)return;
        var fields=new LinkedHashMap<String,Object>();fields.put("accountId",account.publicId);
        fields.put("failureCount",account.pinFailures);
        extra(c,event,reason,fields,mutation);
    }
    static void loginSecurity(String event,String reason,int failures,boolean mutation) {
        var c=ACTIVE.get();if(c!=null)extra(c,event,reason,Map.of("failureCount",failures),mutation);
    }
    private static void extra(Context c,String event,String reason,Map<String,Object> fields,boolean mutation) {
        Runnable record=()->{var row=new LinkedHashMap<String,Object>(fields);row.put("event",event);
            row.put("reasonCode",reason);row.put("outcome","FAILURE");row.put("timestamp",Instant.now().toString());c.additional.add(row);};
        if(mutation) {
            if(!TransactionSynchronizationManager.isSynchronizationActive())throw new IllegalStateException("Audit mutation requires transaction");
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization(){@Override public void afterCommit(){record.run();}});
        } else record.run();
    }
}
