package com.club.bank;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;

/** Run the API checks against Flyway's schema, not Hibernate's automatic DDL. */
@SpringBootTest(properties={
    "bank.demo-inbox-key=test-only-demo-inbox-secret-32-characters",
    "spring.datasource.url=jdbc:h2:mem:flyway_app;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
    "spring.flyway.enabled=true",
    "spring.jpa.hibernate.ddl-auto=validate"
})
@AutoConfigureMockMvc
class MigratedSchemaIntegrationTest extends EncryptedStorageIntegrationTest {}
