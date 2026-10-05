package com.club.bank;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import java.time.LocalDate;
record SavingsJoin(@NotBlank String productId,@NotNull UUID sourceAccountId,
 @com.fasterxml.jackson.databind.annotation.JsonDeserialize(using=MoneyStringDeserializer.class) @NotBlank @Pattern(regexp="[1-9][0-9]{0,7}(\\.[0-9]{1,2})?") String amount,
 @NotBlank String termsVersion,@Size(max=64) String password,@Pattern(regexp="[0-9]{4}") String pin) {}
record SavingsPay(@NotNull UUID sourceAccountId,@NotNull @PositiveOrZero Long version,
 @NotBlank @Size(max=64) String password,@Pattern(regexp="[0-9]{4}") String pin) {}
record SavingsClose(@NotNull UUID targetAccountId,@NotNull @PositiveOrZero Long version,
 @NotNull LocalDate quoteDate,@NotBlank String quoteToken,@NotBlank @Size(max=64) String password) {}
@RestController @RequestMapping("/api/v2")
class SavingsController {
 private final SavingsService service;
 SavingsController(SavingsService service){this.service=service;}
 @GetMapping("/savings-products") Object products(){return service.catalog();}
 @GetMapping("/savings") Object list(){return service.list();}
 @GetMapping("/savings/{id}") Object detail(@PathVariable UUID id){return service.detail(id);}
 @PostMapping("/savings") Object join(@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody SavingsJoin r){return service.join(key,r);}
 @PostMapping("/savings/{id}/payments") Object pay(@PathVariable UUID id,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody SavingsPay r){return service.pay(id,key,r);}
 @GetMapping("/savings/{id}/closure-quote") Object quote(@PathVariable UUID id,@RequestParam UUID targetAccountId){return service.quote(id,targetAccountId);}
 @PostMapping("/savings/{id}/closure") Object close(@PathVariable UUID id,@RequestHeader(value="Idempotency-Key",required=false) String key,@Valid @RequestBody SavingsClose r){return service.close(id,key,r);}
}
