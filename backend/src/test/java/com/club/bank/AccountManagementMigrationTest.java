package com.club.bank;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import java.sql.DriverManager;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
class AccountManagementMigrationTest {
    @Test void upgradesExistingUsersWithExplicitLimitsAndBackfillsKoreanDailyUsage()throws Exception{
        String url="jdbc:h2:mem:mgmt_"+UUID.randomUUID()+";MODE=PostgreSQL;DB_CLOSE_DELAY=-1";
        Flyway.configure().dataSource(url,"sa","").target("2").load().migrate();
        try(var c=DriverManager.getConnection(url,"sa","");var s=c.createStatement()){
            s.executeUpdate("INSERT INTO bank_users(id,username,password_hash) VALUES(100,'Legacy','hash')");
            s.executeUpdate("INSERT INTO accounts(id,number,owner_id,balance) VALUES(100,'2000000000000100',100,100.00)");
            s.executeUpdate("INSERT INTO ledger_entries(account_id,counterparty,amount,created_at,transfer_id) VALUES(100,'2000000000000101',-10.00,TIMESTAMP WITH TIME ZONE '2026-10-01 14:59:59+00:00','first')");
            s.executeUpdate("INSERT INTO ledger_entries(account_id,counterparty,amount,created_at,transfer_id) VALUES(100,'2000000000000101',-20.00,TIMESTAMP WITH TIME ZONE '2026-10-01 15:00:00+00:00','second')");
            s.executeUpdate("INSERT INTO ledger_entries(account_id,counterparty,amount,created_at,transfer_id) VALUES(100,'2000000000000101',30.00,TIMESTAMP WITH TIME ZONE '2026-10-01 15:00:00+00:00','incoming')");
        }
        Flyway.configure().dataSource(url,"sa","").target("11").load().migrate();
        try(var c=DriverManager.getConnection(url,"sa","");var s=c.createStatement()){
            s.executeUpdate("UPDATE accounts SET pin_failures=5,pin_locked_until=TIMESTAMP WITH TIME ZONE '2020-01-01 00:00:00+00:00' WHERE id=100");
            s.executeUpdate("INSERT INTO auth_tokens(token_hash,user_id,expires_at,auth_version) VALUES('old-session',100,TIMESTAMP WITH TIME ZONE '2099-01-01 00:00:00+00:00',0)");
        }
        var flyway=Flyway.configure().dataSource(url,"sa","").load();flyway.migrate();flyway.validate();
        try(var c=DriverManager.getConnection(url,"sa","");var s=c.createStatement()){
            try(var r=s.executeQuery("SELECT COUNT(*) FROM auth_tokens")){assertTrue(r.next());assertEquals(0,r.getInt(1));}
            try(var r=s.executeQuery("SELECT pin_failures,pin_locked_until FROM accounts WHERE id=100")){assertTrue(r.next());assertEquals(4,r.getInt(1));assertNull(r.getObject(2));}
            try(var r=s.executeQuery("SELECT per_transfer_limit,daily_limit FROM bank_users WHERE id=100")){assertTrue(r.next());assertEquals("1000000.00",r.getBigDecimal(1).toPlainString());assertEquals("5000000.00",r.getBigDecimal(2).toPlainString());}
            try(var r=s.executeQuery("SELECT debit_enabled,pin_hash,balance FROM accounts WHERE id=100")){assertTrue(r.next());assertTrue(r.getBoolean(1));assertNull(r.getString(2));assertEquals("100.00",r.getBigDecimal(3).toPlainString());}
            try(var r=s.executeQuery("SELECT usage_date,amount FROM limit_usage WHERE user_id=100 ORDER BY usage_date")){
                assertTrue(r.next());assertEquals("2026-10-01",r.getDate(1).toString());assertEquals("10.00",r.getBigDecimal(2).toPlainString());
                assertTrue(r.next());assertEquals("2026-10-02",r.getDate(1).toString());assertEquals("20.00",r.getBigDecimal(2).toPlainString());assertFalse(r.next());
            }
        }
        assertEquals(0,flyway.migrate().migrationsExecuted);
    }
}
