package com.club.bank;
import jakarta.persistence.*;
import java.time.Instant;
@Entity @Table(name="transfer_actions")
class TransferAction {
    @Id @Column(length=64) String tokenHash;
    @ManyToOne(optional=false) BankUser user;
    @ManyToOne(optional=false) TransferPreview preview;
    @Column(nullable=false,length=16) String purpose="TRANSFER";
    @Column(nullable=false) Instant expiresAt;
    @Column(nullable=false) boolean consumed;
    @Column(nullable=false) long accountSecurityVersion;
    protected TransferAction() {}
}
