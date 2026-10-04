package com.club.bank;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
interface TransferPreviewRepo extends JpaRepository<TransferPreview,String> {
    Optional<TransferPreview> findByIdAndUserId(String id,Long userId);
}
