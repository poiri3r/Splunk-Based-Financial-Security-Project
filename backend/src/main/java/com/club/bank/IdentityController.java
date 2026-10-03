package com.club.bank;
import java.util.*;
import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
@RestController @RequestMapping("/api/v2") class IdentityController {
 private final IdentityService service;IdentityController(IdentityService service){this.service=service;}
 @GetMapping("/terms") Map<String,Object> terms(){return Map.of("items",service.terms());}
 @PostMapping("/contact-challenges") @ResponseStatus(HttpStatus.ACCEPTED) Map<String,Object> start(@Valid @RequestBody ChallengeRequest r,HttpServletRequest req){return service.start(r,req.getRemoteAddr());}
 @PostMapping("/contact-challenges/{id}/verify") Map<String,Object> verify(@PathVariable UUID id,@Valid @RequestBody VerifyChallengeRequest r,HttpServletRequest req){return service.verify(id,r,req.getRemoteAddr());}
 @PostMapping("/auth/register") @ResponseStatus(HttpStatus.CREATED) Map<String,String> register(@Valid @RequestBody ExtendedRegisterRequest r,@RequestHeader(value="Idempotency-Key",required=false) String key,HttpServletRequest req){return service.register(r,key,req.getRemoteAddr());}
 @PutMapping("/me/contact") @ResponseStatus(HttpStatus.NO_CONTENT) void contact(@Valid @RequestBody ContactApplyRequest r){service.contact(r);}
 @GetMapping("/me/terms") Map<String,Object> consents(){return Map.of("items",service.consents());}
 @PostMapping("/me/recovery-codes") Map<String,Object> codes(@Valid @RequestBody PasswordCheckRequest r){return service.issue(r);}
 @GetMapping("/me/recovery-codes") Map<String,Long> status(){return service.codeStatus();}
 @PutMapping("/me/password") @ResponseStatus(HttpStatus.NO_CONTENT) void password(@Valid @RequestBody PasswordChangeRequest r){service.changePassword(r);}
 @PostMapping("/accounts/{id}/pin/reset") @ResponseStatus(HttpStatus.NO_CONTENT) void pin(@PathVariable UUID id,@Valid @RequestBody PinResetRequest r){service.resetPin(id,r);}
}
