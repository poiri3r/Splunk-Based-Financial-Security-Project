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
