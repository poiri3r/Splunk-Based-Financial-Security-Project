package com.club.bank;
import org.springframework.context.annotation.Profile;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import jakarta.validation.Valid;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
@RestController @Profile("demo-verification") class DemoInboxController {
 private final ContactChallengeRepo challenges;private final FieldCrypto crypto;private final String key;
 DemoInboxController(ContactChallengeRepo challenges,FieldCrypto crypto,@Value("${bank.demo-inbox-key:}") String key){
  if(key.length()<32)throw new IllegalStateException("demo-verification requires a private bank.demo-inbox-key of at least 32 characters");
  this.challenges=challenges;this.crypto=crypto;this.key=key;
 }
 @PostMapping("/api/v2/demo/inbox") Map<String,Object> read(@RequestHeader(value="X-Demo-Inbox-Key",required=false) String supplied,@Valid @RequestBody DemoInboxRequest r){
  if(supplied==null||!MessageDigest.isEqual(key.getBytes(StandardCharsets.UTF_8),supplied.getBytes(StandardCharsets.UTF_8)))throw new ApiException(HttpStatus.FORBIDDEN,"FORBIDDEN","모의 수신함 접근 권한이 없습니다.");
  var c=challenges.findById(r.challengeId().toString()).orElse(null);
  if(c==null||c.consumed||c.verified||!Instant.now().isBefore(c.expiresAt)||!SecurityConfig.hash(r.inboxToken()).equals(c.inboxHash))throw new ApiException(HttpStatus.NOT_FOUND,"NOT_FOUND","수신 정보를 확인할 수 없습니다.");
  return Map.of("code",crypto.decrypt("contact_challenges.code",c.id,c.codeEncrypted),"assurance","SIMULATED");
 }
}
