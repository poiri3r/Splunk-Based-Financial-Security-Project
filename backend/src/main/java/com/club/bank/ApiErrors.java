package com.club.bank;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Comparator;

// 프론트는 code로 분기한다. field는 입력 필드를 특정할 수 있을 때만 포함한다.
@JsonInclude(JsonInclude.Include.NON_NULL)
record ApiError(String code, String message, String field) {
    ApiError(String code, String message) { this(code, message, null); }

    // 보안 필터 오류는 ControllerAdvice에 도달하지 않으므로 같은 형식으로 직접 쓴다.
    static void write(HttpServletResponse response, ObjectMapper json, int status, ApiError error) throws IOException {
        response.setStatus(status);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        json.writeValue(response.getOutputStream(), error);
    }
}

// 업무 오류. RuntimeException이므로 거래 도중 발생하면 트랜잭션을 되돌린다.
class ApiException extends RuntimeException {
    final HttpStatus status;
    final ApiError error;
    ApiException(HttpStatus status, String code, String message) { this(status, code, message, null); }
    ApiException(HttpStatus status, String code, String message, String field) {
        super(message);
        this.status = status;
        this.error = new ApiError(code, message, field);
    }
}

@RestControllerAdvice
class ApiErrors extends ResponseEntityExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiErrors.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Object> business(ApiException ex) {
        return ResponseEntity.status(ex.status).body(ex.error);
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        // 여러 필드 오류가 있으면 필드명 순서로 한 건을 반환한다. 입력값 자체는 반환하지 않는다.
        var field = ex.getBindingResult().getFieldErrors().stream()
                .min(Comparator.comparing(org.springframework.validation.FieldError::getField));
        String name = field.map(org.springframework.validation.FieldError::getField).orElse(null);
        return ResponseEntity.badRequest().body(new ApiError("INVALID_INPUT", "입력값의 필수 여부와 형식을 확인해 주세요.", name));
    }

    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(HttpMessageNotReadableException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        return ResponseEntity.badRequest().body(new ApiError("INVALID_INPUT", "JSON 본문과 필드 자료형을 확인해 주세요."));
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object body,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        String code = switch (status.value()) {
            case 400 -> "INVALID_INPUT";
            case 404 -> "NOT_FOUND";
            case 405 -> "METHOD_NOT_ALLOWED";
            case 406 -> "NOT_ACCEPTABLE";
            case 415 -> "UNSUPPORTED_MEDIA_TYPE";
            default -> status.is5xxServerError() ? "INTERNAL_ERROR" : "REQUEST_ERROR";
        };
        return super.handleExceptionInternal(ex, new ApiError(code, "요청 경로, 방식과 형식을 확인해 주세요."), headers, status, request);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Object> unexpected(Exception ex) {
        // 비밀번호나 요청 본문이 로그에 섞이지 않도록 예외 종류만 기록한다.
        log.error("Unhandled API exception type={}", ex.getClass().getName());
        return ResponseEntity.internalServerError().body(new ApiError("INTERNAL_ERROR", "요청 처리 중 오류가 발생했습니다."));
    }
}
