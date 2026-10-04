package com.club.bank;
import jakarta.persistence.*;
import java.time.Instant;
@Entity @Table(name="contact_challenges") class ContactChallenge {
 @Id @Column(length=36) String id;
 @Column Long userId;
 @Column(nullable=false,length=16) String purpose;
 @Column(nullable=false,length=8) String channel;
 @Column(nullable=false,columnDefinition="text") String contactEncrypted;
 @Column(nullable=false,length=64) String contactLookup;
 @Column(nullable=false,length=64) String codeHash;
 @Column(columnDefinition="text") String codeEncrypted;
 @Column(nullable=false,length=64) String inboxHash;
 @Column(unique=true,length=64) String grantHash;
 @Column(nullable=false) Instant expiresAt;
 @Column Instant grantExpiresAt;
 @Column(nullable=false) int failures;
 @Column(nullable=false) boolean verified;
 @Column(nullable=false) boolean consumed;
}
