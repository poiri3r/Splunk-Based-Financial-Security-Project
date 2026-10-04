package com.club.bank;
import org.springframework.boot.*;
import org.springframework.context.annotation.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.math.BigDecimal;
@Configuration class DemoData {
 @Bean @Profile("demo") CommandLineRunner seed(UserRepo users,AccountRepo accounts,PasswordEncoder encoder,FieldCrypto crypto){
  return args->{
   String[][] fixtures={{"alice","Demo!Alice7392","김시연","+821090002951","2000000000000001","4826","100000.00"},
                        {"bob","Demo!Bob5837","이시연","+821090002963","2000000000000002","7391","50000.00"}};
   for(String[] f:fixtures){
    if(users.findByUsernameLookup(crypto.lookup("bank_users.username",f[0])).isPresent())continue;
    var u=new BankUser(f[0],encoder.encode(f[1]),crypto);u.nameEncrypted=crypto.encrypt("bank_users.name",u.publicId,f[2]);
    u.phoneEncrypted=crypto.encrypt("bank_users.phone",u.publicId,f[3]);u.phoneLookup=crypto.lookup("bank_users.phone",f[3]);u.phoneAssurance="SIMULATED";users.save(u);
    var a=new Account(f[4],u,new BigDecimal(f[6]),crypto);a.pinHash=encoder.encode(f[5]);accounts.save(a);
   }
  };
 }
}
