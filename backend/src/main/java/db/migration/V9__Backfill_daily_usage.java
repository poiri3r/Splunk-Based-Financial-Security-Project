package db.migration;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import java.math.BigDecimal;
import java.sql.*;
import java.time.*;
/** Convert the actual instant, independent of JDBC/session timezone or SQL DATE cast behavior. */
public class V9__Backfill_daily_usage extends BaseJavaMigration {
    @Override public Integer getChecksum(){return 1;}
    @Override public void migrate(Context context)throws Exception {
        var connection=context.getConnection();
        try(var select=connection.prepareStatement("SELECT a.owner_id,e.amount,e.created_at FROM ledger_entries e JOIN accounts a ON a.id=e.account_id WHERE e.amount<0 ORDER BY a.owner_id,e.created_at,e.id");
            var insert=connection.prepareStatement("INSERT INTO limit_usage(id,user_id,usage_date,amount) VALUES(?,?,?,?)")){
            select.setFetchSize(1000);
            try(var rows=select.executeQuery()){
                Long owner=null;LocalDate day=null;BigDecimal total=BigDecimal.ZERO.setScale(2);
                while(rows.next()){
                    long nextOwner=rows.getLong(1);
                    LocalDate nextDay=rows.getObject(3,OffsetDateTime.class).toInstant().atZone(ZoneId.of("Asia/Seoul")).toLocalDate();
                    if(owner!=null && (owner!=nextOwner || !day.equals(nextDay))){save(insert,owner,day,total);total=BigDecimal.ZERO.setScale(2);}
                    owner=nextOwner;day=nextDay;total=total.subtract(rows.getBigDecimal(2));
                }
                if(owner!=null)save(insert,owner,day,total);
            }
        }
    }
    private static void save(PreparedStatement insert,long owner,LocalDate day,BigDecimal amount)throws SQLException {
        insert.setString(1,owner+":"+day);insert.setLong(2,owner);insert.setObject(3,day);insert.setBigDecimal(4,amount);insert.executeUpdate();
    }
}
