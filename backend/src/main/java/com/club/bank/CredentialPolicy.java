package com.club.bank;
import org.springframework.stereotype.Component;
import org.springframework.http.HttpStatus;
import java.nio.charset.StandardCharsets;

/** Project credential policy. Long passwords remain supported; this is not KB's length limit. */
@Component class CredentialPolicy {
 private final FieldCrypto crypto;
 CredentialPolicy(FieldCrypto crypto){this.crypto=crypto;}
 static ApiException weak(String field){return new ApiException(HttpStatus.BAD_REQUEST,"WEAK_CREDENTIAL","반복·연속·개인정보를 피한 비밀번호를 입력해 주세요.",field);}
 static boolean predictable(String s){
  String lower=s.toLowerCase(java.util.Locale.ROOT);
  for(int i=0;i+4<=lower.length();i++){
   String part=lower.substring(i,i+4);
   if(part.chars().distinct().count()==1)return true;
   for(String seq:new String[]{"0123456789","9876543210","abcdefghijklmnopqrstuvwxyz","zyxwvutsrqponmlkjihgfedcba"})if(seq.contains(part))return true;
  }
  return false;
 }
 void password(String value,String username,String phone){password(value,username,phone,"password");}
 void password(String value,String username,String phone,String field){
  if(value==null||value.length()<12||value.length()>64||value.getBytes(StandardCharsets.UTF_8).length>72
    ||!value.matches("(?s).*[A-Za-z].*")||!value.matches("(?s).*[0-9].*")||!value.matches("(?s).*[^A-Za-z0-9\\s].*")
    ||value.codePoints().anyMatch(Character::isISOControl)||value.equalsIgnoreCase(username)||predictable(value)
    ||(phone!=null&&value.contains(phone.substring(Math.max(0,phone.length()-4)))))throw weak(field);
 }
 void password(String value,BankUser u){password(value,u.username(crypto),phone(u));}
 void newPassword(String value,BankUser u){password(value,u.username(crypto),phone(u),"newPassword");}
 String phone(BankUser u){return u.phoneEncrypted==null?null:crypto.decrypt("bank_users.phone",u.publicId,u.phoneEncrypted);}
 void pin(String value,BankUser u){
  String phone=phone(u);
  if(value==null||!value.matches("[0-9]{4}")||predictable(value)||(phone!=null&&phone.contains(value)))throw weak("pin");
 }
 static void banking(BankUser u){
  if(u.nameEncrypted==null||u.phoneEncrypted==null||!"SIMULATED".equals(u.phoneAssurance))
   throw new ApiException(HttpStatus.FORBIDDEN,"BANKING_SETUP_REQUIRED","이름과 모의 휴대폰 확인을 완료해 주세요.");
 }
}
