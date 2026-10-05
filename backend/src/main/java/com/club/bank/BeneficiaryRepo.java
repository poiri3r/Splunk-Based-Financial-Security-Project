package com.club.bank;
import java.util.*;
import org.springframework.data.jpa.repository.JpaRepository;
interface BeneficiaryRepo extends JpaRepository<Beneficiary,String>{
    List<Beneficiary> findByUserIdOrderByCreatedAtAscIdAsc(Long userId);
    Optional<Beneficiary> findByIdAndUserId(String id,Long userId);
    boolean existsByUserIdAndBankCodeAndNumberLookup(Long userId,String bankCode,String lookup);
    long countByUserId(Long userId);
}
