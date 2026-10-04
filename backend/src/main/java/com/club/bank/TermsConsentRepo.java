package com.club.bank;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
interface TermsConsentRepo extends JpaRepository<TermsConsent,Long>{List<TermsConsent> findByUserIdOrderById(Long user);}
