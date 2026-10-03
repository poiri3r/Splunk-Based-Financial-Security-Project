package com.club.bank;
import jakarta.persistence.*;
@Entity @Table(name="registration_receipts") class RegistrationReceipt {
 @Id @Column(length=36) String id;
 @Column(nullable=false,length=64) String requestHash;
 @Column(nullable=false,length=36) String customerId;
}
