package com.club.bank;
import org.springframework.boot.*;
import org.springframework.context.annotation.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.math.BigDecimal;
@Configuration class DemoData {
 @Bean @Profile("demo") CommandLineRunner seed(UserRepo users,AccountRepo accounts,PasswordEncoder encoder,FieldCrypto crypto){
  return args->{
   String[][] fixtures={{"alice","Demo!Alice7392","김시연","+821090002951","2000000000000001","4826","100000.00"},
                        {"bob","Demo!Bob5837","이시연","+821090002963","2000000000000002","7391","50000.00"},
                        {"test1","test1test1test1","테스트일","+821011110001","2100000000000001","4826","1000000.00"},
                        {"test1","test1test1test1","테스트일","+821011110001","2100000000000002","4826","500000.00"},
                        {"test1","test1test1test1","테스트일","+821011110001","2100000000000003","4826","100000.00"},
                        {"test2","test2test2test2","테스트이","+821022220002","2200000000000001","7391","1000000.00"},
                        {"test2","test2test2test2","테스트이","+821022220002","2200000000000002","7391","500000.00"},
                        {"test2","test2test2test2","테스트이","+821022220002","2200000000000003","7391","100000.00"}};
   for(String[] f:fixtures){
    var existing=users.findByUsernameLookup(crypto.lookup("bank_users.username",f[0]));
    BankUser u;
    if(existing.isPresent())u=existing.get();
    else{
     u=new BankUser(f[0],encoder.encode(f[1]),crypto);u.nameEncrypted=crypto.encrypt("bank_users.name",u.publicId,f[2]);
     u.phoneEncrypted=crypto.encrypt("bank_users.phone",u.publicId,f[3]);u.phoneLookup=crypto.lookup("bank_users.phone",f[3]);u.phoneAssurance="SIMULATED";users.save(u);
    }
    if(accounts.findByNumberLookup(crypto.lookup("accounts.number",f[4])).isPresent())continue;
    var a=new Account(f[4],u,new BigDecimal(f[6]),crypto);a.pinHash=encoder.encode(f[5]);accounts.save(a);
   }
  };
 }
}
