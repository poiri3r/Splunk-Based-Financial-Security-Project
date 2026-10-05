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
// 거래내역 표에 접근하는 도구.
interface LedgerRepo extends JpaRepository<LedgerEntry,Long>, org.springframework.data.jpa.repository.JpaSpecificationExecutor<LedgerEntry> {
    // 해당 계좌의 내역을 생성 시각 내림차순, 같으면 ID 내림차순으로 조회한다.
    List<LedgerEntry> findByAccountIdOrderByCreatedAtDescIdDesc(Long accountId);
    @Query("select coalesce(max(e.id),0) from LedgerEntry e where e.account.id=:accountId")
    long maxId(@Param("accountId") Long accountId);
}
