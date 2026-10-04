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
