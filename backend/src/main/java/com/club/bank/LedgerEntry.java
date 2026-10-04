/*
 * Model.java: DB의 표(테이블)와 Java 객체를 연결하는 설계.
 * @Entity: DB에 저장할 객체 / @Table: 연결할 표 이름 / @Column: 칸의 규칙.
 * @Id: 행을 식별하는 기본키 / @GeneratedValue: DB가 번호를 자동 생성.
 * nullable=false: 빈 값 불가 / unique=true: 중복 불가.
 * 생성자는 new로 객체를 만들 때 값을 채운다. 인자 없는 protected 생성자는 JPA가 사용한다.
 * SQL의 owner_id처럼 밑줄 이름인 칼럼을 Java에서는 owner 같은 필드로 연결한다.
 */
package com.club.bank;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
// 입출금 내역 표. 송금은 출금·입금 두 행, 가상 입금은 한 행을 남긴다.
@Entity @Table(name="ledger_entries") class LedgerEntry {
    // DB 내부 식별자. 사용자가 보는 계좌번호와 별개다.
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
    // 이 거래내역이 어느 계좌의 것인지 참조한다.
    @ManyToOne(optional=false) Account account;
    // 상대 계좌번호 또는 SIMULATED_CASH_DEPOSIT 같은 거래 출처.
    @Column(name="counterparty_enc",nullable=false,columnDefinition="text") String counterpartyEncrypted;
    @Column(name="public_id",nullable=false,unique=true,length=36) String publicId=java.util.UUID.randomUUID().toString();
    // 총 19자리, 소수 2자리의 십진수. BigDecimal을 사용해 금액의 부동소수점 오차를 피한다.
    @Column(nullable=false,precision=19,scale=2) BigDecimal amount;
    // 거래가 생성된 시각.
    @Column(nullable=false) Instant createdAt;
    // 같은 송금의 출금·입금 내역을 연결하는 ID. 가상 입금 식별에도 사용한다.
    @Column(nullable=false) String transferId;
    @Column(precision=19,scale=2) BigDecimal balanceAfter;
    protected LedgerEntry() {
    }
    LedgerEntry(Account a,String c,BigDecimal v,String t,FieldCrypto crypto) {
        account=a;
        counterpartyEncrypted=crypto.encrypt("ledger_entries.counterparty",publicId,c);
        amount=v;
        transferId=t;
        // 객체를 만들 때 현재 시각을 기록한다.
        createdAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        balanceAfter=a.balance;
    }
    String counterparty(FieldCrypto crypto) { return crypto.decrypt("ledger_entries.counterparty",publicId,counterpartyEncrypted); }
}
