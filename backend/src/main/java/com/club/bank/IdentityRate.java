package com.club.bank;
import jakarta.persistence.*;
import java.time.Instant;
@Entity @Table(name="identity_rates") class IdentityRate {
 @Id @Column(length=64) String id;
 @Column(nullable=false) Instant until;
 @Column(nullable=false) int attempts;
}
