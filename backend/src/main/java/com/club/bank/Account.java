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
// 계좌 표. 로그인 사용자 한 명은 여러 계좌를 가질 수 있다.
@Entity @Table(name="accounts") class Account {
    // DB 내부 식별자. 사용자가 보는 계좌번호와 별개다.
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
    // 외부 응답에 표시되는 계좌번호.
    @Column(name="number_enc",nullable=false,columnDefinition="text") String numberEncrypted;
    @Column(name="public_id",nullable=false,unique=true,length=36) String publicId=java.util.UUID.randomUUID().toString();
    @Column(name="number_lookup",nullable=false,unique=true,length=64) String numberLookup;
    // 여러 계좌가 사용자 한 명을 참조한다. 소유자 연결은 필수다.
    // Load owner separately so account refresh/row locks do not also lock the recipient user.
    @ManyToOne(optional=false,fetch=FetchType.LAZY) BankUser owner;
    // 총 19자리, 소수 2자리의 십진수. BigDecimal을 사용해 금액의 부동소수점 오차를 피한다.
    @Column(nullable=false,precision=19,scale=2) BigDecimal balance;
    @Column(nullable=false) String accountName="프로젝트 입출금통장";
    @Column(nullable=false,length=20) String accountType="CHECKING";
    @Column(nullable=false,length=3) String currency="KRW";
    @Column(nullable=false,length=20) String status="ACTIVE";
    @Column java.time.Instant openedAt;
    @Column(length=32) String openingTermsVersion;
    @Column Instant openingTermsAcceptedAt;
    @Column(columnDefinition="text") String aliasEncrypted;
    @Column(nullable=false) boolean hidden;
    @Column(nullable=false) int displayOrder;
    @Column(nullable=false) boolean debitEnabled=true;
    @Column(nullable=false) long settingsVersion;
    @Column(length=100) String pinHash;
    @Column(nullable=false) int pinFailures;
    @Column Instant pinLockedUntil;
    @Column(nullable=false) long securityVersion;
    protected Account() {
    }
    Account(String n,BankUser u,BigDecimal b,FieldCrypto crypto) {
        openedAt=java.time.Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        numberEncrypted=crypto.encrypt("accounts.number",publicId,n);
        numberLookup=crypto.lookup("accounts.number",n);
        owner=u;
        balance=b;
    }
    String number(FieldCrypto crypto) { return crypto.decrypt("accounts.number",publicId,numberEncrypted); }
}
