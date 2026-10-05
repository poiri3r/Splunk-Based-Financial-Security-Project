package com.club.bank;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.Map;

@Service class SessionService {
 private final TokenRepo tokens;
 SessionService(TokenRepo tokens){this.tokens=tokens;}
 record Principal(Long userId,long version){}
 @Transactional public Principal authenticate(String hash,boolean touch){
  Instant now=Instant.now();var t=tokens.findById(hash).orElse(null);
  if(t==null||!t.expiresAt.isAfter(now)||!t.lastActivityAt.plusSeconds(600).isAfter(now)||t.authVersion!=t.user.getAuthVersion())return null;
  // Conditional update prevents concurrent requests from reviving an expired/deleted token.
  if(touch&&tokens.touch(hash,now,now.minusSeconds(600))!=1)return null;
  return new Principal(t.user.getId(),t.authVersion);
 }
 @Transactional(readOnly=true) public Map<String,Object> status(String raw){
  var t=tokens.findById(SecurityConfig.hash(raw)).orElseThrow(()->new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","로그인이 필요합니다."));
  if(!t.expiresAt.isAfter(Instant.now())||!t.lastActivityAt.plusSeconds(600).isAfter(Instant.now())||t.authVersion!=t.user.getAuthVersion())throw new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","로그인이 필요합니다.");
  Instant idle=t.lastActivityAt.plusSeconds(600),end=idle.isBefore(t.expiresAt)?idle:t.expiresAt;
  return Map.of("idleExpiresAt",end,"absoluteExpiresAt",t.expiresAt,"idleTimeoutSeconds",600);
 }
}
