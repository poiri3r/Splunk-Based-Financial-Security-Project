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
// 토큰 표. 원본 토큰이 아닌 조회용 해시와 만료 시각을 보관한다.
@Entity @Table(name="auth_tokens") class AuthToken {
    // 토큰 해시 자체를 기본키로 사용한다.
    @Id String tokenHash;
    // 토큰을 발급받은 사용자와 연결한다.
    @ManyToOne(optional=false) BankUser user;
    // 토큰 만료 시각. TokenFilter가 현재 시각과 비교한다.
    @Column(nullable=false) Instant expiresAt;
    @Column(nullable=false) Instant lastActivityAt=Instant.now();
    @Column(nullable=false) long authVersion;
    protected AuthToken() {
    }
    AuthToken(String h,BankUser u,Instant e) {
        tokenHash=h;
        user=u;authVersion=u.getAuthVersion();
        expiresAt=e;
    }
}
