package com.club.bank;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
@Service class LoginRate {
 private final IdentityGate gate;private final IdentityService identity;
 LoginRate(IdentityGate gate,IdentityService identity){this.gate=gate;this.identity=identity;}
 @Transactional(noRollbackFor=IdentityFailure.class) public void check(String ip){
  gate.lock();identity.rate("login-ip:"+ip,30,60);
 }
}
