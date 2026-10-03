package com.club.bank;
import jakarta.persistence.*;
import java.time.Instant;
@Entity @Table(name="recovery_codes") class RecoveryCode {
 @Id @Column(length=64) String codeHash;
 @Column(nullable=false) Long userId;
 @Column(nullable=false) Instant createdAt;
 @Column(nullable=false) boolean consumed;
}
