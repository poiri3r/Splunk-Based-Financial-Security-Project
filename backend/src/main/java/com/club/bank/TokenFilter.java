/*
 * SecurityConfig.java: 요청의 접근 규칙과 로그인 토큰 검사.
 * 요청 → TokenFilter가 토큰 조회 → Spring Security가 인증 여부 확인 → Api.java.
 * 비밀번호 해시는 BCrypt, 임의 토큰의 조회 키는 SHA-256이다. 둘의 용도가 다르다.
 */
package com.club.bank;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.context.annotation.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.security.web.savedrequest.NullRequestCache;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
// @Component: Spring이 필터 객체를 관리한다. extends는 기존 필터 클래스를 상속한다는 뜻.
@Component class TokenFilter extends OncePerRequestFilter {
    // DB에서 토큰 해시와 만료 시각을 찾는 도구.
    private final SessionService sessions;
    TokenFilter(SessionService sessions){this.sessions=sessions;}
    // @Override는 부모 클래스 메서드를 구현한다는 표시. req는 요청, res는 응답, chain은 다음 처리 단계.
    @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain) throws java.io.IOException,ServletException {
        // Authorization 헤더를 읽는다. 예: Bearer 발급받은토큰.
        String header=req.getHeader("Authorization");
        // &&는 두 조건이 모두 참일 때. Bearer 접두어 7글자를 substring(7)로 제거한다.
        // 원본 대신 해시로 DB 조회 → 만료 시각 검사 → 유효하면 사용자 ID를 인증 정보에 저장한다.
        // ifPresent는 조회 결과가 있을 때만 실행한다. List.of()는 빈 권한 목록이며 현재 역할 구분은 없다.
        if(header!=null && header.startsWith("Bearer ")) {
            boolean touch=!("GET".equals(req.getMethod()) && req.getRequestURI().equals("/api/v2/auth/session"));
            var principal=sessions.authenticate(SecurityConfig.hash(header.substring(7)),touch);
            if(principal!=null)SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal.userId(),principal.version(),java.util.List.of()));
        }
        // 다음 필터/요청 처리로 진행한다. 토큰이 없거나 만료됐으면 보호된 API 접근은 이후 단계에서 거절된다.
        chain.doFilter(req,res);
    }
}
