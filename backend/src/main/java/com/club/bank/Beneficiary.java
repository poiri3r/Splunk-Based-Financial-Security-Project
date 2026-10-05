package com.club.bank;
import jakarta.persistence.*;
import java.time.Instant;
@Entity @Table(name="beneficiaries",uniqueConstraints=@UniqueConstraint(columnNames={"user_id","bank_code","number_lookup"}))
class Beneficiary {
    @Id @Column(length=36) String id;
    @Column(nullable=false) Long userId;
    @Column(nullable=false,length=16) String bankCode;
    @Column(nullable=false,columnDefinition="text") String numberEncrypted;
    @Column(nullable=false,length=64) String numberLookup;
    @Column(columnDefinition="text") String aliasEncrypted;
    @Column(nullable=false) Instant createdAt;
    @Column(nullable=false) long version;
    protected Beneficiary(){}
}
