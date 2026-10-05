package com.club.bank;
import org.springframework.context.annotation.*;
import org.springframework.http.HttpStatus;
interface VerificationSender {void deliver(ContactChallenge challenge,String code);}
@Configuration class VerificationDelivery {
 @Bean @Profile("!demo-verification") VerificationSender disabledSender(){return (c,code)->{throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,"DELIVERY_DISABLED","연락처 인증 발송이 비활성화되어 있습니다.");};}
 @Bean @Profile("demo-verification") VerificationSender demoSender(FieldCrypto crypto){return (c,code)->c.codeEncrypted=crypto.encrypt("contact_challenges.code",c.id,code);}
}
