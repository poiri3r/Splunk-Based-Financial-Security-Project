/*
 * Repositories.java: 사용자·계좌·거래내역·토큰을 DB에서 조회하고 저장하는 인터페이스.
 * interface는 기능의 약속이다. Spring Data JPA가 이 약속을 구현하는 객체를 만든다.
 * JpaRepository<BankUser,Long>은 사용자 객체와 Long 기본키를 다룬다는 뜻.
 * save/findById 등의 기본 함수는 상속받으며, 추가 조회는 함수 이름이나 @Query로 정의한다.
 * Optional<T>: 결과가 없을 수도 있는 값 / List<T>: 여러 결과의 목록.
 */
package com.club.bank;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import java.util.*;
// 토큰 해시(String 기본키)로 인증 정보를 찾는다. 기본 함수만 사용하므로 본문이 비어 있다.
interface TokenRepo extends JpaRepository<AuthToken,String> {
    @org.springframework.data.jpa.repository.Modifying
    @Query("update AuthToken t set t.lastActivityAt=case when t.lastActivityAt<:now then :now else t.lastActivityAt end where t.tokenHash=:hash and t.expiresAt>:now and t.lastActivityAt>:cutoff")
    int touch(String hash,java.time.Instant now,java.time.Instant cutoff);
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query("delete from AuthToken t where t.tokenHash=:hash and t.user.id=:userId")
    int revoke(@org.springframework.data.repository.query.Param("hash") String hash,@org.springframework.data.repository.query.Param("userId") Long userId);

 @org.springframework.data.jpa.repository.Modifying @org.springframework.data.jpa.repository.Query("delete from AuthToken t where t.user.id=:user") void revokeAll(Long user);
}
