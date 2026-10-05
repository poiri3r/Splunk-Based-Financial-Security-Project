package com.club.bank;
import org.springframework.data.jpa.repository.JpaRepository;
interface SettingActionRepo extends JpaRepository<SettingAction,String>{
 @org.springframework.data.jpa.repository.Modifying @org.springframework.data.jpa.repository.Query("delete from SettingAction t where t.userId=:user") void revoke(Long user);
}
