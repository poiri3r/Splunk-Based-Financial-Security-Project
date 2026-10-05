package com.club.bank;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
@Entity @Table(name="transfer_records")
class TransferRecord {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
    @Column(nullable=false,unique=true,length=36) String publicId;
    @ManyToOne(optional=false) BankUser user;
    @OneToOne(optional=false) TransferPreview preview;
    @Column(nullable=false,precision=19,scale=2) BigDecimal amount;
    @Column(nullable=false,precision=19,scale=2) BigDecimal balanceAfter;
    @Column(nullable=false,columnDefinition="text") String snapshotEncrypted;
    @Column(nullable=false) Instant createdAt;
    protected TransferRecord() {}
}
