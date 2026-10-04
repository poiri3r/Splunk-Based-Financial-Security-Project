package com.club.bank;
import org.springframework.web.bind.annotation.*;
import org.springframework.context.annotation.Profile;
import jakarta.validation.Valid;
import java.util.Map;
@RestController @Profile("demo") @RequestMapping("/api/v2/demo") class BankController {
 private final BankService bank;BankController(BankService bank){this.bank=bank;}
 @PostMapping("/deposits") Map<String,String> deposit(@Valid @RequestBody DepositRequest r,@RequestHeader(value="Idempotency-Key",required=false) String key){return bank.deposit(r,key);}
}
