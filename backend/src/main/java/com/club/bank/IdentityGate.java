package com.club.bank;
import jakarta.persistence.*;
import org.springframework.data.jpa.repository.*;
import org.springframework.stereotype.Component;
import org.springframework.boot.*;
import org.springframework.jdbc.core.JdbcTemplate;
@Entity @Table(name="identity_gate") class IdentityMutex {
 @Id Integer id;
}
interface IdentityMutexRepo extends JpaRepository<IdentityMutex,Integer>{
 @Lock(LockModeType.PESSIMISTIC_WRITE) @org.springframework.data.jpa.repository.Query("select m from IdentityMutex m where m.id=1") IdentityMutex acquire();
}
@Component class IdentityGate implements ApplicationRunner {
 private final IdentityMutexRepo repo;private final JdbcTemplate jdbc;
 IdentityGate(IdentityMutexRepo repo,JdbcTemplate jdbc){this.repo=repo;this.jdbc=jdbc;}
 @Override public void run(ApplicationArguments args){try{jdbc.update("INSERT INTO identity_gate(id) VALUES(1)");}catch(org.springframework.dao.DuplicateKeyException alreadyExists){}}
 void lock(){if(repo.acquire()==null)throw new IllegalStateException("Identity gate not initialized");}
}
