package com.club.bank;
import jakarta.persistence.*;
import java.time.Instant;
@Entity @Table(name="recovery_grants") class RecoveryGrant {
 @Id @Column(length=64) String tokenHash;
 @Column(nullable=false) Long userId;
 @Column(nullable=false) long authVersion;
 @Column(nullable=false,length=24) String purpose;
 @Column(nullable=false) Instant expiresAt;
 @Column(nullable=false) boolean consumed;
}
interface RecoveryGrantRepo extends org.springframework.data.jpa.repository.JpaRepository<RecoveryGrant,String>{}
