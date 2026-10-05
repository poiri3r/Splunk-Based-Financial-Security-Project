package com.club.bank;
import jakarta.persistence.*;
@Entity @Table(name="crypto_metadata")
class CryptoMetadata {
    @Id @Column(length=16) String id;
    @Column(nullable=false,columnDefinition="text") String encryptedCheck;
    @Column(nullable=false,length=64) String lookupCheck;
    protected CryptoMetadata() {}
    CryptoMetadata(FieldCrypto crypto) {
        id="v1";
        encryptedCheck=crypto.encrypt("crypto_metadata.check",id,"bank-crypto-check-v1");
        lookupCheck=crypto.lookup("crypto_metadata.check","bank-crypto-check-v1");
    }
}
