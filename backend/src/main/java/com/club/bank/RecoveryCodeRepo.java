package com.club.bank;
import org.springframework.data.jpa.repository.*;
interface RecoveryCodeRepo extends JpaRepository<RecoveryCode,String>{
 @Modifying @Query("delete from RecoveryCode r where r.userId=:user") void revoke(Long user);
 long countByUserIdAndConsumedFalse(Long user);
}
