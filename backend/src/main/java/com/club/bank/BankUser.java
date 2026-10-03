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
    @Column(name="username_enc",nullable=false,columnDefinition="text") String usernameEncrypted;
    @Column(name="public_id",nullable=false,unique=true,length=36) String publicId=java.util.UUID.randomUUID().toString();
    @Column(name="username_lookup",nullable=false,unique=true,length=64) String usernameLookup;
    // 비밀번호 원문 대신 BCrypt 해시를 보관한다.
    @Column(nullable=false) String passwordHash;
    @Column(columnDefinition="text") String nameEncrypted;
    @Column(columnDefinition="text") String emailEncrypted;
    @Column(length=64) String emailLookup;
    @Column(columnDefinition="text") String phoneEncrypted;
    @Column(length=64) String phoneLookup;
    @Version @Column(nullable=false) long profileVersion;
    @Column(precision=19,scale=2) BigDecimal perTransferLimit=new BigDecimal("1000000.00");
    @Column(precision=19,scale=2) BigDecimal dailyLimit=new BigDecimal("5000000.00");
    @Column(nullable=false) long limitVersion;
    @Column(nullable=false) long authVersion;
    @Column(nullable=false) int loginFailures;
    @Column(nullable=false,length=16) String emailAssurance="UNVERIFIED";
    @Column(nullable=false,length=16) String phoneAssurance="UNVERIFIED";
    public long getAuthVersion(){return authVersion;}
    protected BankUser() {
    }
    BankUser(String u,String p,FieldCrypto crypto) {
        usernameEncrypted=crypto.encrypt("bank_users.username",publicId,u);
        usernameLookup=crypto.lookup("bank_users.username",u);
        passwordHash=p;
    }
    public Long getId() { return id; }
    public String getPublicId() { return publicId; }
    public String getNameEncrypted() { return nameEncrypted; }
    String username(FieldCrypto crypto) { return crypto.decrypt("bank_users.username",publicId,usernameEncrypted); }
}
