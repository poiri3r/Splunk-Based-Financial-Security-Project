package com.club.bank;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import java.sql.DriverManager;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

/** Same migration can be run on an empty disposable PostgreSQL DB through system properties. */
class EncryptionMigrationTest {
    @Test void existingRowsMoveToEncryptedStorageWithoutChangingMoneyOrReplayRecords() throws Exception {
        String url=System.getProperty("migration.test.url","jdbc:h2:mem:migration_"+UUID.randomUUID()+";MODE=PostgreSQL;DB_CLOSE_DELAY=-1");
        String user=System.getProperty("migration.test.user","sa"),password=System.getProperty("migration.test.password","");
        Flyway.configure().dataSource(url,user,password).target("2").load().migrate();
        try(var c=DriverManager.getConnection(url,user,password);var s=c.createStatement()) {
            s.executeUpdate("INSERT INTO bank_users(id,username,password_hash) VALUES(100,'Alice','existing-bcrypt')");
            s.executeUpdate("INSERT INTO accounts(id,number,owner_id,balance) VALUES(100,'10010001',100,70.00)");
            s.executeUpdate("INSERT INTO ledger_entries(account_id,counterparty,amount,created_at,transfer_id) VALUES(100,'10010002',-30.00,CURRENT_TIMESTAMP,'legacy-transfer')");
            s.executeUpdate("INSERT INTO idempotency_records(user_id,request_key,request_hash,operation,result_id,created_at) VALUES(100,'00000000-0000-0000-0000-000000000001','legacy-hash','TRANSFER','legacy-transfer',CURRENT_TIMESTAMP)");
        }
        var flyway=Flyway.configure().dataSource(url,user,password).load();
        flyway.migrate();flyway.validate();assertEquals(0,flyway.migrate().migrationsExecuted);
        FieldCrypto crypto=new FieldCrypto();
        try(var c=DriverManager.getConnection(url,user,password);var s=c.createStatement()) {
            try(var r=s.executeQuery("SELECT public_id,username_enc,username_lookup,password_hash FROM bank_users WHERE id=100")) {
                assertTrue(r.next());assertEquals("Alice",crypto.decrypt("bank_users.username",r.getString(1),r.getString(2)));
                assertEquals(crypto.lookup("bank_users.username","Alice"),r.getString(3));assertEquals("existing-bcrypt",r.getString(4));
            }
            try(var r=s.executeQuery("SELECT public_id,number_enc,balance FROM accounts WHERE id=100")) {
                assertTrue(r.next());assertEquals("10010001",crypto.decrypt("accounts.number",r.getString(1),r.getString(2)));
                assertEquals(0,r.getBigDecimal(3).compareTo(new java.math.BigDecimal("70.00")));
            }
            try(var r=s.executeQuery("SELECT public_id,counterparty_enc,amount FROM ledger_entries WHERE account_id=100")) {
                assertTrue(r.next());assertEquals("10010002",crypto.decrypt("ledger_entries.counterparty",r.getString(1),r.getString(2)));
                assertEquals(0,r.getBigDecimal(3).compareTo(new java.math.BigDecimal("-30.00")));
            }
            try(var r=s.executeQuery("SELECT request_hash,result_id FROM idempotency_records WHERE user_id=100")) {
                assertTrue(r.next());assertEquals("legacy-hash",r.getString(1));assertEquals("legacy-transfer",r.getString(2));
            }
            for(String[] f:new String[][]{{"bank_users","username"},{"accounts","number"},{"ledger_entries","counterparty"}}) {
                assertThrows(java.sql.SQLException.class,()->s.executeQuery("SELECT "+f[1]+" FROM "+f[0]));
            }
        }
    }
}
