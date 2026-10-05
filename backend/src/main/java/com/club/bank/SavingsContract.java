package com.club.bank;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.springframework.data.jpa.repository.JpaRepository;
@Entity @Table(name="savings_contracts")
class SavingsContract {
 @Id @Column(length=36) String id=UUID.randomUUID().toString();
 @Column(nullable=false) Long userId;
 @Column(nullable=false,unique=true) Long accountId;
 @Column(nullable=false,length=24) String productId;
 @Column(nullable=false,length=32) String termsVersion;
 @Column(nullable=false) Instant acceptedAt;
 @Column(nullable=false) LocalDate openedOn;
 @Column(nullable=false) LocalDate maturityOn;
 @Column(nullable=false) int months;
 @Column(nullable=false,precision=8,scale=6) BigDecimal annualRate;
 @Column(nullable=false,precision=8,scale=6) BigDecimal earlyRate;
 @Column(nullable=false,precision=19,scale=2) BigDecimal installment;
 @Column(nullable=false,length=16) String status="ACTIVE";
 @Column(nullable=false) long version;
 LocalDate closedOn;
}
interface SavingsContractRepo extends JpaRepository<SavingsContract,String> {
 Optional<SavingsContract> findByIdAndUserId(String id,Long userId);
 List<SavingsContract> findByUserIdOrderByAcceptedAtDesc(Long userId);
}
@Entity @Table(name="savings_payments",uniqueConstraints=@UniqueConstraint(columnNames={"contract_id","period_index"}))
class SavingsPayment {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
 @Column(nullable=false,length=36) String contractId;
 @Column(nullable=false) int periodIndex;
 @Column(nullable=false) LocalDate paidOn;
 @Column(nullable=false,precision=19,scale=2) BigDecimal amount;
}
interface SavingsPaymentRepo extends JpaRepository<SavingsPayment,Long> {
 List<SavingsPayment> findByContractIdOrderByPeriodIndex(String contractId);
 boolean existsByContractIdAndPeriodIndex(String contractId,int periodIndex);
}
@Entity @Table(name="savings_receipts")
class SavingsReceipt {
 @Id @Column(length=36) String id=UUID.randomUUID().toString();
 @Column(nullable=false,columnDefinition="text") String resultEncrypted;
}
interface SavingsReceiptRepo extends JpaRepository<SavingsReceipt,String> {}
