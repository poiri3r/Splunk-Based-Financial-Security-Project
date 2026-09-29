/*
 * Health.java: GET /health 요청에 간단한 서버 응답을 반환한다.
 */
package com.club.bank;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
// 이 클래스가 HTTP 요청을 받아 응답하도록 등록한다.
@RestController class Health {
    // GET /health 경로. 상태 확인이므로 인증 없이 호출하도록 SecurityConfig에 허용돼 있다.
    @GetMapping("/health") Map<String,String> health() {
        // JSON {"status":"ok"}로 응답한다. 이 코드는 DB 연결 상태까지 검사하지 않는다.
        return Map.of("status","ok");
    }
}
