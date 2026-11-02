package com.club.bank;
import org.junit.jupiter.api.Test;
import java.util.Base64;
import static org.junit.jupiter.api.Assertions.*;

class FieldCryptoTest {
    final FieldCrypto crypto = new FieldCrypto();
    @Test void encryptionIsRandomizedAndBoundToRowAndField() {
        String a=crypto.encrypt("accounts.number","row-a","10010001");
        assertNotEquals(a,crypto.encrypt("accounts.number","row-a","10010001"));
        assertEquals("10010001",crypto.decrypt("accounts.number","row-a",a));
        assertThrows(IllegalStateException.class,()->crypto.decrypt("accounts.number","row-b",a));
        assertThrows(IllegalStateException.class,()->crypto.decrypt("bank_users.username","row-a",a));
        byte[] changed=Base64.getDecoder().decode(a.substring(3));changed[changed.length-1]^=1;
        assertThrows(IllegalStateException.class,()->crypto.decrypt("accounts.number","row-a","v1:"+Base64.getEncoder().encodeToString(changed)));
        FieldCrypto wrong=new FieldCrypto(Base64.getEncoder().encodeToString(new byte[32]),System.getenv("BANK_LOOKUP_KEY"));
        assertThrows(IllegalStateException.class,()->wrong.decrypt("accounts.number","row-a",a));
    }
    @Test void lookupIsExactAndFieldSeparatedAndMissingKeysFailClosed() {
        assertEquals(crypto.lookup("username","Alice"),crypto.lookup("username","Alice"));
        assertNotEquals(crypto.lookup("username","Alice"),crypto.lookup("username","alice"));
        assertNotEquals(crypto.lookup("username","Alice"),crypto.lookup("account","Alice"));
        assertThrows(IllegalStateException.class,()->new FieldCrypto(null,null));
        assertThrows(IllegalStateException.class,()->new FieldCrypto("bad","bad"));
        assertThrows(IllegalStateException.class,()->new FieldCrypto(System.getenv("BANK_LOOKUP_KEY"),System.getenv("BANK_LOOKUP_KEY")));
    }
}
