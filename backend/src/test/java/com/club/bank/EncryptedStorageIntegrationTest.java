package com.club.bank;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.http.MediaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
@SpringBootTest(properties="bank.demo-inbox-key=test-only-demo-inbox-secret-32-characters") @AutoConfigureMockMvc
@org.springframework.test.context.ActiveProfiles({"demo","demo-verification"})
class EncryptedStorageIntegrationTest {
    @Autowired CryptoMetadataRepo metadata;
    @Autowired MockMvc mvc; @Autowired JdbcTemplate jdbc; @Autowired ObjectMapper json; @Autowired FieldCrypto crypto;
    @Test void apiStaysReadableWhileDatabaseContainsNoPlaintextIdentityColumns() throws Exception {
        var helper=new V6Support();helper.mvc=mvc;helper.json=json;helper.jdbc=jdbc;helper.crypto=crypto;
        var c=helper.customer();String username=c.username(),token=c.token(),number=c.number();
        String stored=jdbc.queryForObject("SELECT username_enc FROM bank_users WHERE username_lookup=?",String.class,crypto.lookup("bank_users.username",username));
        assertTrue(stored.startsWith("v1:"));assertNotEquals(username,stored);
        assertNotEquals(number,jdbc.queryForObject("SELECT number_enc FROM accounts WHERE number_lookup=?",String.class,crypto.lookup("accounts.number",number)));
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM auth_tokens WHERE token_hash=?",Integer.class,SecurityConfig.hash(token)));
        assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.queryForList("SELECT username FROM bank_users"));
    }
    @Test void existingDatabaseRejectsChangedEncryptionOrLookupKey() {
        String other=java.util.Base64.getEncoder().encodeToString(new byte[32]);
        var args=new org.springframework.boot.DefaultApplicationArguments(new String[0]);
        assertThrows(IllegalStateException.class,()->new CryptoKeyVerifier(metadata,new FieldCrypto(other,System.getenv("BANK_LOOKUP_KEY"))).run(args));
        assertThrows(IllegalStateException.class,()->new CryptoKeyVerifier(metadata,new FieldCrypto(System.getenv("BANK_ENCRYPTION_KEY"),other)).run(args));
    }
}
