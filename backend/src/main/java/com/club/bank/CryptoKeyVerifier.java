package com.club.bank;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Prevents an existing database from being opened with a different key pair. */
@Component @Order(org.springframework.core.Ordered.HIGHEST_PRECEDENCE)
class CryptoKeyVerifier implements ApplicationRunner {
    private final CryptoMetadataRepo repository;
    private final FieldCrypto crypto;
    CryptoKeyVerifier(CryptoMetadataRepo repository,FieldCrypto crypto) {this.repository=repository;this.crypto=crypto;}
    @Override @Transactional public void run(ApplicationArguments args) {
        CryptoMetadata m=repository.findById("v1").orElseGet(()->repository.saveAndFlush(new CryptoMetadata(crypto)));
        String expected="bank-crypto-check-v1";
        if(!expected.equals(crypto.decrypt("crypto_metadata.check","v1",m.encryptedCheck)) ||
            !crypto.lookup("crypto_metadata.check",expected).equals(m.lookupCheck))
            throw new IllegalStateException("저장된 데이터와 암호화/검색 키가 일치하지 않습니다.");
    }
}
