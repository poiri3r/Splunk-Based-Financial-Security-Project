package com.club.bank;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
@Entity @Table(name="transfer_previews")
class TransferPreview {
    @Id @Column(length=36) String id;
    @ManyToOne(optional=false) BankUser user;
    @ManyToOne(optional=false) Account source;
    @ManyToOne(optional=false) Account target;
    @Column(nullable=false,precision=19,scale=2) BigDecimal amount;
    @Column(nullable=false,columnDefinition="text") String snapshotEncrypted;
    @Column(nullable=false) Instant expiresAt;
    @Column(length=36,unique=true) String resultId;
    protected TransferPreview() {}
}
