package com.club.bank;
import org.springframework.data.jpa.repository.JpaRepository;
interface TransferActionRepo extends JpaRepository<TransferAction,String> {
 @org.springframework.data.jpa.repository.Modifying @org.springframework.data.jpa.repository.Query("delete from TransferAction t where t.user.id=:user") void revoke(Long user);
}
