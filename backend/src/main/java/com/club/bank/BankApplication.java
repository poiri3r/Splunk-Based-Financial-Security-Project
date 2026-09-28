/*
 * BankApplication.java: Java 프로그램의 실행 시작점.
 * Spring Boot가 API, 보안, DB 연결을 준비하고 내장 Tomcat으로 HTTP 요청을 받는다.
 */
package com.club.bank;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
// Spring Boot 설정과 같은 패키지 아래 구성요소 검색을 활성화한다.
@SpringBootApplication public class BankApplication {
    // main은 Java 실행 시작 함수. static은 객체 생성 없이 호출, void는 반환값 없음.
    // String[] args는 실행 시 전달한 문자열 인자들의 배열이다.
    public static void main(String[] args) {
        // 이 클래스를 기준으로 Spring Boot 애플리케이션을 시작한다.
        SpringApplication.run(BankApplication.class, args);
    }
}
