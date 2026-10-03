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
// @Configuration은 Spring 설정을 선언하는 클래스라는 표시다.
@Configuration class SecurityConfig {
    // @Bean: 반환 객체를 Spring이 관리해 다른 코드에 공급한다.
    @Bean PasswordEncoder passwordEncoder() {
        // 비밀번호를 복호화하는 것이 아니라 해시 생성·비교 도구를 제공한다.
        return new BCryptPasswordEncoder();
    }
    // URL 접근 규칙과 인증 필터를 구성한다. throws는 처리 중 예외가 생길 수 있음을 뜻한다.
    @Bean SecurityFilterChain filterChain(HttpSecurity http,TokenFilter filter,ObjectMapper json) throws Exception {
        // 이 내부 API는 Authorization 헤더의 토큰을 사용하며 HTTP 세션을 만들지 않는다.
        // CSRF 검사를 끈 것은 이 인증 방식에 대한 설정이다. 쿠키 세션을 쓰는 DMZ BFF에는 별도 CSRF 방어가 필요하다.
        // permitAll: 회원가입·로그인·health는 공개. 나머지는 authenticated: 인증 필요.
        // addFilterBefore: 표준 필터 앞에서 TokenFilter 실행. 인증 실패 응답은 401.
        // 점(.)으로 설정 메서드를 이어 부르는 방식을 메서드 체이닝이라고 한다.
        return http.csrf(c->c.disable())
            .sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .requestCache(c->c.requestCache(new NullRequestCache())) 
            .authorizeHttpRequests(a->a.dispatcherTypeMatchers(jakarta.servlet.DispatcherType.ERROR).permitAll()
                .requestMatchers(org.springframework.http.HttpMethod.GET,"/api/v2/terms").permitAll()
                .requestMatchers(org.springframework.http.HttpMethod.POST,"/api/v2/auth/login","/api/v2/auth/register","/api/v2/contact-challenges","/api/v2/contact-challenges/*/verify","/api/v2/recovery/password","/api/v2/recovery/verifications","/api/v2/recovery/login-unlock","/api/v2/demo/inbox").permitAll()
                .requestMatchers(org.springframework.http.HttpMethod.GET,"/api/v2/savings-products").permitAll()
                .requestMatchers("/api/auth/**","/api/accounts/**","/api/transfers","/api/deposits").denyAll()
                .requestMatchers("/health","/error").permitAll().anyRequest().authenticated()) 
            .addFilterBefore(filter,UsernamePasswordAuthenticationFilter.class) 
            .exceptionHandling(e->e.authenticationEntryPoint((req,res,ex)->{
                res.setHeader("WWW-Authenticate","Bearer");
                ApiError.write(res,json,401,new ApiError("UNAUTHORIZED","로그인이 필요하거나 토큰이 만료되었습니다."));
            }).accessDeniedHandler((req,res,ex)->
                ApiError.write(res,json,403,new ApiError("FORBIDDEN","접근 권한이 없습니다."))))
            .build();
    }
    // 필터는 보안 체인 안에서만 실행한다. 서블릿 필터 자동 등록에 의한 중복 실행을 막는다.
    @Bean FilterRegistrationBean<TokenFilter> tokenFilterRegistration(TokenFilter filter) {
        FilterRegistrationBean<TokenFilter> registration=new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }
    // 입력 토큰을 SHA-256으로 해시해 DB의 token_hash와 비교할 수 있는 문자열로 만든다.
    static String hash(String raw) {
        try {
            // 문자열 → UTF-8 바이트 → SHA-256 해시 → 16진수 문자열 순서로 변환한다.
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8)));
        }
        // 해시 처리 중 예외를 잡는다. 이 코드에는 원본 토큰을 출력하는 로그가 없다.
        catch(Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
