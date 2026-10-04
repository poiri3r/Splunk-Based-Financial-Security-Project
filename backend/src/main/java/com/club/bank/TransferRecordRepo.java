package com.club.bank;
import java.util.Optional;
import org.springframework.data.jpa.repository.*;
interface TransferRecordRepo extends JpaRepository<TransferRecord,Long>,JpaSpecificationExecutor<TransferRecord> {
    Optional<TransferRecord> findByPublicIdAndUserId(String publicId,Long userId);
    @Query("select coalesce(max(t.id),0) from TransferRecord t where t.user.id=:userId")
    long maximumId(Long userId);
}
