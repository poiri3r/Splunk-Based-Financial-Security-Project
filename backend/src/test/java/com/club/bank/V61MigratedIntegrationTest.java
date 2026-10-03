package com.club.bank;
import org.springframework.boot.test.context.SpringBootTest;
@SpringBootTest(properties={"bank.demo-inbox-key=test-only-demo-inbox-secret-32-characters","spring.datasource.url=jdbc:h2:mem:v61_migrated;MODE=PostgreSQL;DB_CLOSE_DELAY=-1","spring.flyway.enabled=true","spring.jpa.hibernate.ddl-auto=validate"})
class V61MigratedIntegrationTest extends V61IntegrationTest {}
