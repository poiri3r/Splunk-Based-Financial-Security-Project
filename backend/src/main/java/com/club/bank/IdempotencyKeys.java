package com.club.bank;
import java.util.UUID;
import org.springframework.http.HttpStatus;
final class IdempotencyKeys {
 private IdempotencyKeys() {}
 static String require(String value) {
  try { if(value==null || !UUID.fromString(value).toString().equals(value)) throw new IllegalArgumentException(); }
  catch(IllegalArgumentException ex) { throw new ApiException(HttpStatus.BAD_REQUEST,"IDEMPOTENCY_KEY_INVALID","Idempotency-Key는 소문자 표준 UUID 형식이어야 합니다."); }
  return value;
 }
}
