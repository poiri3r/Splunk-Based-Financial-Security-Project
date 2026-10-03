package db.migration;

import com.club.bank.FieldCrypto;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import java.sql.Connection;
import java.util.UUID;

/** Maintenance-window migration: all application writers must be stopped first. */
public class V4__Encrypt_existing_personal_data extends BaseJavaMigration {
    @Override public Integer getChecksum() { return 1; }
    @Override public void migrate(Context context) throws Exception {
        FieldCrypto crypto = new FieldCrypto(); // fail closed even on an empty database
        try(var s=context.getConnection().createStatement();var r=s.executeQuery("SELECT COUNT(*) FROM bank_users")) {
            r.next();
            if(r.getLong(1)>0 && !"true".equals(System.getenv("BANK_ALLOW_PII_MIGRATION")))
                throw new IllegalStateException("기존 DB의 백업과 쓰기 중단 후 BANK_ALLOW_PII_MIGRATION=true를 설정하세요.");
        }
        migrateTable(context.getConnection(),crypto,"bank_users","username",true);
        migrateTable(context.getConnection(),crypto,"accounts","number",true);
        migrateTable(context.getConnection(),crypto,"ledger_entries","counterparty",false);
        try(var insert=context.getConnection().prepareStatement("INSERT INTO crypto_metadata(id,encrypted_check,lookup_check) VALUES('v1',?,?)")) {
            insert.setString(1,crypto.encrypt("crypto_metadata.check","v1","bank-crypto-check-v1"));
            insert.setString(2,crypto.lookup("crypto_metadata.check","bank-crypto-check-v1"));
            insert.executeUpdate();
        }
    }
    private void migrateTable(Connection db, FieldCrypto crypto, String table, String field, boolean lookup) throws Exception {
        // Identifiers above are source-code constants, never supplied by an API caller.
        String query="SELECT id,"+field+",public_id FROM "+table+" ORDER BY id";
        String update="UPDATE "+table+" SET public_id=?,"+field+"_enc=?"+(lookup?","+field+"_lookup=?":"")+" WHERE id=?";
        try(var select=db.createStatement(); var write=db.prepareStatement(update)) {
            select.setFetchSize(500);
            try(var rows=select.executeQuery(query)) {
                while(rows.next()) {
                    String raw=rows.getString(2);
                    String publicId=rows.getString(3);
                    if(publicId==null) publicId=UUID.randomUUID().toString();
                    String scope=table+"."+field;
                    String encrypted=crypto.encrypt(scope,publicId,raw);
                    if(!raw.equals(crypto.decrypt(scope,publicId,encrypted))) throw new IllegalStateException("Migration verification failed");
                    write.setString(1,publicId);write.setString(2,encrypted);
                    int last=3;
                    if(lookup) write.setString(last++,crypto.lookup(scope,raw));
                    write.setLong(last,rows.getLong(1));write.executeUpdate();
                }
            }
        }
    }
}
