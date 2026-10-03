package com.club.bank;
import org.springframework.stereotype.Component;
import org.springframework.http.HttpStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
/** Signed, filter-bound cursor. Client must return it unchanged. */
@Component
class TransactionCursor {
    record Position(String account,String from,String to,String type,long maximumId,Instant time,long id) {}
    private final FieldCrypto crypto;private final ObjectMapper json;
    TransactionCursor(FieldCrypto crypto,ObjectMapper json){this.crypto=crypto;this.json=json;}
    String encode(Position p) {
        try {
            String body=Base64.getUrlEncoder().withoutPadding().encodeToString(json.writeValueAsBytes(p));
            return body+"."+crypto.lookup("cursor.transactions.v1",body);
        }catch(Exception e){throw new IllegalStateException("페이지 생성 실패");}
    }
    Position decode(String cursor,String account,String from,String to,String type) {
        try {
            if(cursor.length()>2048)throw new IllegalArgumentException();
            String[] parts=cursor.split("\\.",-1);
            if(parts.length!=2 || !MessageDigest.isEqual(parts[1].getBytes(StandardCharsets.UTF_8),
                crypto.lookup("cursor.transactions.v1",parts[0]).getBytes(StandardCharsets.UTF_8)))throw new IllegalArgumentException();
            Position p=json.readValue(Base64.getUrlDecoder().decode(parts[0]),Position.class);
            if(!account.equals(p.account())||!from.equals(p.from())||!to.equals(p.to())||!type.equals(p.type())||
                p.time()==null||p.id()<=0||p.maximumId()<p.id())throw new IllegalArgumentException();
            return p;
        }catch(Exception e){throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","조회 조건과 페이지 정보를 확인해 주세요.","cursor");}
    }
}
