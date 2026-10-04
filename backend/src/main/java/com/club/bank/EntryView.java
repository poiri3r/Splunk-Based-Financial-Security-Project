/*
 * Api.java: 은행 API의 입력·출력 형식, 업무 처리, HTTP 주소를 모은 파일.
 * 읽는 순서: BankController(요청 접수) → BankService(처리) → Repository(DB).
 * import: 라이브러리 사용 선언 / class: 데이터와 기능을 묶는 단위 / record: 값 묶음.
 * String: 문자열 / Long: 정수 / BigDecimal: 정확한 십진수 금액 / Instant: 시각.
 * 메서드: 이름(...) 형태의 기능 / return: 결과 반환 / new: 객체 생성 / ;: 문장 끝.
 * public: 외부에서 호출 가능 / private: 해당 클래스 안에서 사용 / void: 반환값 없음.
 * 이 파일은 DMZ의 화면 코드가 아니라 내부망 API 서버에서 실행된다.
 */
package com.club.bank;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.*;
import org.springframework.security.authentication.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.security.SecureRandom;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
// 거래내역 응답: 거래 ID, 상대 계좌/거래 출처, 금액, 생성 시각.
record EntryView(String transferId,String counterparty,BigDecimal amount,Instant createdAt) {
}
