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
// 사용자 표. 가입 아이디와 비밀번호 해시를 저장한다.
@Entity @Table(name="bank_users") class BankUser {
    // DB 내부 식별자. 사용자가 보는 계좌번호와 별개다.
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
    // 가입 시 사용한 아이디. DB에서도 중복을 막는다.
    @Column(nullable=false,unique=true) String username;
    // 비밀번호 원문 대신 BCrypt 해시를 보관한다.
    @Column(nullable=false) String passwordHash;
    protected BankUser() {
    }
    BankUser(String u,String p) {
        username=u;
        passwordHash=p;
    }
}
// 계좌 표. 로그인 사용자 한 명은 여러 계좌를 가질 수 있다.
@Entity @Table(name="accounts") class Account {
    // DB 내부 식별자. 사용자가 보는 계좌번호와 별개다.
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
    // 외부 응답에 표시되는 계좌번호.
    @Column(nullable=false,unique=true) String number;
    // 여러 계좌가 사용자 한 명을 참조한다. 소유자 연결은 필수다.
    @ManyToOne(optional=false) BankUser owner;
    // 총 19자리, 소수 2자리의 십진수. BigDecimal을 사용해 금액의 부동소수점 오차를 피한다.
    @Column(nullable=false,precision=19,scale=2) BigDecimal balance;
    protected Account() {
    }
    Account(String n,BankUser u,BigDecimal b) {
        number=n;
        owner=u;
        balance=b;
    }
}
// 입출금 내역 표. 송금은 출금·입금 두 행, 가상 입금은 한 행을 남긴다.
@Entity @Table(name="ledger_entries") class LedgerEntry {
    // DB 내부 식별자. 사용자가 보는 계좌번호와 별개다.
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
    // 이 거래내역이 어느 계좌의 것인지 참조한다.
    @ManyToOne(optional=false) Account account;
    // 상대 계좌번호 또는 SIMULATED_CASH_DEPOSIT 같은 거래 출처.
    @Column(nullable=false) String counterparty;
    // 총 19자리, 소수 2자리의 십진수. BigDecimal을 사용해 금액의 부동소수점 오차를 피한다.
    @Column(nullable=false,precision=19,scale=2) BigDecimal amount;
    // 거래가 생성된 시각.
    @Column(nullable=false) Instant createdAt;
    // 같은 송금의 출금·입금 내역을 연결하는 ID. 가상 입금 식별에도 사용한다.
    @Column(nullable=false) String transferId;
    protected LedgerEntry() {
    }
    LedgerEntry(Account a,String c,BigDecimal v,String t) {
        account=a;
        counterparty=c;
        amount=v;
        transferId=t;
        // 객체를 만들 때 현재 시각을 기록한다.
        createdAt=Instant.now();
    }
}
// 토큰 표. 원본 토큰이 아닌 조회용 해시와 만료 시각을 보관한다.
@Entity @Table(name="auth_tokens") class AuthToken {
    // 토큰 해시 자체를 기본키로 사용한다.
    @Id String tokenHash;
    // 토큰을 발급받은 사용자와 연결한다.
    @ManyToOne(optional=false) BankUser user;
    // 토큰 만료 시각. TokenFilter가 현재 시각과 비교한다.
    @Column(nullable=false) Instant expiresAt;
    protected AuthToken() {
    }
    AuthToken(String h,BankUser u,Instant e) {
        tokenHash=h;
        user=u;
        expiresAt=e;
    }
}
// 요청 재시도 기록. 사용자와 키 조합은 한 번만 처리하며 결과를 DB에 보존한다.
@Entity @Table(name="idempotency_records",uniqueConstraints=@UniqueConstraint(columnNames={"user_id","request_key"}))
class IdempotencyRecord {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) Long id;
    @ManyToOne(optional=false) BankUser user;
    @Column(name="request_key",nullable=false,length=36) String requestKey;
    @Column(nullable=false,length=64) String requestHash;
    @Column(nullable=false,length=16) String operation;
    @Column(nullable=false,length=36) String resultId;
    @Column(nullable=false) Instant createdAt;
    protected IdempotencyRecord() {}
    IdempotencyRecord(BankUser user,String requestKey,String requestHash,String operation,String resultId) {
        this.user=user;
        this.requestKey=requestKey;
        this.requestHash=requestHash;
        this.operation=operation;
        this.resultId=resultId;
        this.createdAt=Instant.now();
    }
}
