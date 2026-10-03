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
