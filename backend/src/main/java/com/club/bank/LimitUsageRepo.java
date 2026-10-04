package com.club.bank;
import org.springframework.data.jpa.repository.JpaRepository;
interface LimitUsageRepo extends JpaRepository<LimitUsage,String>{}
