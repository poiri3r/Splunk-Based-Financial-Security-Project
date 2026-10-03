package com.club.bank;
import java.util.*;
import org.springframework.data.jpa.repository.*;
interface ContactChallengeRepo extends JpaRepository<ContactChallenge,String>{
 Optional<ContactChallenge> findByGrantHash(String hash);
 @Modifying @Query("update ContactChallenge c set c.consumed=true where c.purpose=:purpose and c.channel=:channel and c.contactLookup=:lookup and ((:owner is null and c.userId is null) or c.userId=:owner)")
 void invalidate(String purpose,String channel,String lookup,Long owner);
 @Modifying @Query("update ContactChallenge c set c.consumed=true where c.userId=:user") void revoke(Long user);
}
