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
// 계좌 표에 접근하는 도구.
interface AccountRepo extends JpaRepository<Account,Long> {
    Optional<Account> findByPublicIdAndOwnerId(String publicId, Long ownerId);
    // 소유자 ID가 같은 계좌만 내부 ID 오름차순으로 조회한다.
    List<Account> findByOwnerIdOrderById(Long ownerId);
    // 계좌번호로 조회한다. 이 함수 자체에는 소유권 검사가 없으므로 서비스에서 확인한다.
    Optional<Account> findByNumberLookup(String number);
    // 비관적 쓰기 잠금: 트랜잭션 동안 해당 DB 행의 동시 변경을 조정한다.
    // @Query는 테이블명이 아니라 Java 엔티티 이름을 사용하는 JPQL이다.
    // :id 자리에 @Param("id")의 인자가 들어간다. 동시 갱신 전체의 정확성은 별도 검증이 필요하다.
    @Lock(LockModeType.PESSIMISTIC_WRITE) @Query("select a from Account a where a.id = :id") Optional<Account> findLockedById(@Param("id") Long id);
}
