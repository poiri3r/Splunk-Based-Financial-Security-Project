package com.club.bank;
import jakarta.persistence.*;
import java.time.Instant;
@Entity @Table(name="terms_consents",uniqueConstraints=@UniqueConstraint(columnNames={"user_id","term_id","term_version"})) class TermsConsent {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
 @Column(nullable=false) Long userId;
 @Column(nullable=false,length=32) String termId;
 @Column(nullable=false,length=32) String termVersion;
 @Column(nullable=false) Instant acceptedAt;
}
