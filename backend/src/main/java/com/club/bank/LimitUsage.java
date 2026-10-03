package com.club.bank;
import jakarta.persistence.*;
import java.time.LocalDate;
import java.math.BigDecimal;
@Entity @Table(name="limit_usage",uniqueConstraints=@UniqueConstraint(columnNames={"user_id","usage_date"}))
class LimitUsage {
    @Id @Column(length=64) String id;
    @Column(nullable=false) Long userId;
    @Column(nullable=false) LocalDate usageDate;
    @Column(nullable=false,precision=38,scale=2) BigDecimal amount=BigDecimal.ZERO.setScale(2);
    protected LimitUsage(){}
    LimitUsage(String id,Long user,LocalDate day){this.id=id;userId=user;usageDate=day;}
}
