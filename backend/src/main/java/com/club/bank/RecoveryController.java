package com.club.bank;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
@RestController @RequestMapping("/api/v2/recovery") class RecoveryController {
 private final RecoveryService service;RecoveryController(RecoveryService service){this.service=service;}
 @PostMapping("/verifications") Map<String,Object> verify(@Valid @RequestBody RecoveryProof r,HttpServletRequest req){return service.verify(r,req.getRemoteAddr());}
 @PostMapping("/password") @ResponseStatus(HttpStatus.NO_CONTENT) void password(@Valid @RequestBody PasswordReset r,HttpServletRequest req){service.password(r,req.getRemoteAddr());}
 @PostMapping("/login-unlock") @ResponseStatus(HttpStatus.NO_CONTENT) void unlock(@Valid @RequestBody LoginUnlock r,HttpServletRequest req){service.unlock(r,req.getRemoteAddr());}
}
