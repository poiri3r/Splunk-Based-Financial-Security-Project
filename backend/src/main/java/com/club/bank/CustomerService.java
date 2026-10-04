package com.club.bank;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.http.HttpStatus;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
@Service
class CustomerService {
    private final CurrentCustomer current; private final UserRepo users; private final TokenRepo tokens;
    private final IdentityGate gate; private final IdentityService identity;
    private final FieldCrypto crypto; private final PasswordEncoder passwords;
    CustomerService(CurrentCustomer current,UserRepo users,TokenRepo tokens,FieldCrypto crypto,PasswordEncoder passwords,IdentityGate gate,IdentityService identity) {
        this.gate=gate;this.identity=identity;this.current=current;this.users=users;this.tokens=tokens;this.crypto=crypto;this.passwords=passwords;
    }
    @Transactional(readOnly=true) public CustomerView me() {return view(current.get());}
    @Transactional public void logout(String authorization) {
        if(authorization==null || !authorization.startsWith("Bearer ")) throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","로그인이 필요합니다.");
        tokens.revoke(SecurityConfig.hash(authorization.substring(7)),current.id());
    }
    @Transactional(noRollbackFor=IdentityFailure.class) public CustomerView update(UpdateCustomerRequest r) {
        gate.lock();identity.rate("profile-password:"+current.id(),5,300);
        BankUser u=current.locked();
        if(r.currentPassword().getBytes(StandardCharsets.UTF_8).length>72 || !passwords.matches(r.currentPassword(),u.passwordHash))
            throw new IdentityFailure(HttpStatus.UNAUTHORIZED,"REAUTHENTICATION_FAILED","현재 비밀번호가 올바르지 않습니다.");
        if(r.version()!=u.profileVersion) throw new ApiException(HttpStatus.CONFLICT,"PROFILE_VERSION_CONFLICT","정보가 변경되었습니다. 다시 조회해 주세요.");
        String name=optional(r.name(),"name"), email=optional(r.email(),"email"), phone=optional(r.phone(),"phone");
        if(email!=null) {
            int at=email.lastIndexOf('@');
            if(at<1 || at==email.length()-1) throw invalid("email");
            email=email.substring(0,at)+email.substring(at).toLowerCase(Locale.ROOT);
        }
        if(phone!=null) {
            phone=phone.replace(" ","").replace("-","");
            if(phone.matches("0[0-9]{8,10}")) phone="+82"+phone.substring(1);
            if(!phone.matches("\\+[1-9][0-9]{7,14}")) throw invalid("phone");
        }
        String oldName=decrypt(u,"name",u.nameEncrypted),oldPhone=decrypt(u,"phone",u.phoneEncrypted);
        if(name==null || (oldName!=null&&!oldName.equals(name)))throw new ApiException(HttpStatus.CONFLICT,"IDENTITY_CHANGE_NOT_ALLOWED","등록한 이름은 이 화면에서 변경할 수 없습니다.");
        if(!java.util.Objects.equals(phone,oldPhone))throw new ApiException(HttpStatus.FORBIDDEN,"CONTACT_CONFIRMATION_REQUIRED","연락처 변경은 모의 확인 후 적용해 주세요.");
        u.nameEncrypted=encrypt(u,"name",name);
        if(!java.util.Objects.equals(email,decrypt(u,"email",u.emailEncrypted)))u.emailAssurance="UNVERIFIED";
        if(!java.util.Objects.equals(phone,decrypt(u,"phone",u.phoneEncrypted)))u.phoneAssurance="UNVERIFIED";
        u.emailEncrypted=encrypt(u,"email",email);u.emailLookup=email==null?null:crypto.lookup("bank_users.email",email);
        u.phoneEncrypted=encrypt(u,"phone",phone);u.phoneLookup=phone==null?null:crypto.lookup("bank_users.phone",phone);
        users.flush(); // @Version is incremented before building the response.
        return view(u);
    }
    private String optional(String v,String field) {
        if(v==null)return null;
        v=v.strip();if(v.isEmpty()||v.codePoints().anyMatch(Character::isISOControl))throw invalid(field);
        return v;
    }
    private ApiException invalid(String field) {return new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","입력값의 형식을 확인해 주세요.",field);}
    private String encrypt(BankUser u,String field,String value) {return value==null?null:crypto.encrypt("bank_users."+field,u.publicId,value);}
    private String decrypt(BankUser u,String field,String value) {return value==null?null:crypto.decrypt("bank_users."+field,u.publicId,value);}
    private CustomerView view(BankUser u) {
        return new CustomerView(u.publicId,u.username(crypto),decrypt(u,"name",u.nameEncrypted),decrypt(u,"email",u.emailEncrypted),
            decrypt(u,"phone",u.phoneEncrypted),false,false,u.profileVersion,u.emailAssurance,u.phoneAssurance,u.nameEncrypted!=null&&u.phoneEncrypted!=null&&"SIMULATED".equals(u.phoneAssurance));
    }
}
