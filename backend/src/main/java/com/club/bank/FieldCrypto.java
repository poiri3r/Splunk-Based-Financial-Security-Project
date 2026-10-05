package com.club.bank;

import org.springframework.stereotype.Component;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Arrays;

/** 개인정보의 표시용 암호문과 정확 일치 검색값을 분리한다. 키 누락 시 서버 시작 실패. */
@Component
public class FieldCrypto {
    private final byte[] encryptionKey;
    private final byte[] lookupKey;
    private final SecureRandom random = new SecureRandom();

    public FieldCrypto() {
        this(System.getenv("BANK_ENCRYPTION_KEY"), System.getenv("BANK_LOOKUP_KEY"));
    }
    public FieldCrypto(String encryption, String lookup) {
        encryptionKey = key(encryption);
        lookupKey = key(lookup);
        if (Arrays.equals(encryptionKey, lookupKey)) throw new IllegalStateException("암호화 키와 검색 키는 달라야 합니다.");
    }
    private static byte[] key(String value) {
        try {
            byte[] bytes = Base64.getDecoder().decode(value);
            if (bytes.length != 32) throw new IllegalArgumentException();
            return bytes;
        } catch (Exception e) {
            throw new IllegalStateException("BANK_ENCRYPTION_KEY와 BANK_LOOKUP_KEY에 각각 Base64 인코딩한 32바이트 키가 필요합니다.");
        }
    }
    private byte[] aad(String field, String row) {
        return ("bank:v1:" + field + ":" + row).getBytes(StandardCharsets.UTF_8);
    }
    public String encrypt(String field, String row, String value) {
        try {
            byte[] nonce = new byte[12]; random.nextBytes(nonce);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(encryptionKey, "AES"), new GCMParameterSpec(128, nonce));
            c.updateAAD(aad(field, row));
            byte[] encrypted = c.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] payload = new byte[nonce.length + encrypted.length];
            System.arraycopy(nonce, 0, payload, 0, nonce.length);
            System.arraycopy(encrypted, 0, payload, nonce.length, encrypted.length);
            return "v1:" + Base64.getEncoder().encodeToString(payload);
        } catch (Exception e) { throw new IllegalStateException("개인정보 암호화 실패"); }
    }
    public String decrypt(String field, String row, String envelope) {
        try {
            if (!envelope.startsWith("v1:")) throw new IllegalArgumentException();
            byte[] payload = Base64.getDecoder().decode(envelope.substring(3));
            if (payload.length < 28) throw new IllegalArgumentException();
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(encryptionKey, "AES"), new GCMParameterSpec(128, Arrays.copyOf(payload,12)));
            c.updateAAD(aad(field,row));
            return new String(c.doFinal(payload,12,payload.length-12),StandardCharsets.UTF_8);
        } catch (Exception e) { throw new IllegalStateException("개인정보 복호화 실패: 키 또는 데이터 무결성을 확인하세요."); }
    }
    /** 기존 API 호환을 위해 대소문자·공백·계좌번호 표기를 임의 변경하지 않는다. */
    public String lookup(String field, String value) {
        try {
            Mac mac=Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(lookupKey,"HmacSHA256"));
            byte[] bytes=value.getBytes(StandardCharsets.UTF_8);
            return HexFormat.of().formatHex(mac.doFinal(("v1:"+field+":"+bytes.length+":"+value).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException("개인정보 검색값 생성 실패"); }
    }
}
