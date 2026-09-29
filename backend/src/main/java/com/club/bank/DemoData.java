/*
 * DemoData.java: demo 실행 옵션에서 예제 사용자와 잔액이 있는 계좌를 생성한다.
 * 가입·계좌 개설 API로 직접 만든 사용자와는 별도의 초기 시연 데이터다.
 */
package com.club.bank;
import org.springframework.boot.*;
import org.springframework.context.annotation.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.math.BigDecimal;
// 예제 데이터 생성 작업을 Spring 설정으로 등록한다.
@Configuration class DemoData {
    // demo 프로필에서만 실행될 CommandLineRunner를 만든다. 일반 실행에는 이 작업이 없다.
    @Bean @Profile("demo") CommandLineRunner seed(UserRepo users,AccountRepo accounts,PasswordEncoder encoder) {
        // 애플리케이션 시작 후 호출할 함수를 반환한다. ->는 람다 함수 표기다.
        return args-> {
            // alice가 이미 있으면 생성 작업 전체를 건너뛴다. bob이나 계좌가 일부 빠졌는지까지 확인하지는 않는다.
            if(users.findByUsername("alice").isPresent()) return;
            // 예제 alice 사용자를 저장한다. 공개 예제 비밀번호도 DB에는 해시로 저장한다.
            BankUser alice=users.save(new BankUser("alice",encoder.encode("DemoPass123!")));
            // 예제 bob 사용자를 저장한다.
            BankUser bob=users.save(new BankUser("bob",encoder.encode("DemoPass456!")));
            // alice의 계좌 10010001에 시연용 초기 잔액 100000.00을 설정한다.
            accounts.save(new Account("10010001",alice,new BigDecimal("100000.00")));
            // bob의 계좌 10010002에 시연용 초기 잔액 50000.00을 설정한다.
            accounts.save(new Account("10010002",bob,new BigDecimal("50000.00")));
        }
        ;
    }
}
