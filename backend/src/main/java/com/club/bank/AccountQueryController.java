package com.club.bank;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import org.springframework.format.annotation.DateTimeFormat;
import java.time.LocalDate;
import java.util.*;
@RestController @RequestMapping("/api/v2/accounts")
class AccountQueryController {
    private final AccountQueryService service;
    AccountQueryController(AccountQueryService service){this.service=service;}
    @GetMapping AccountList list(@RequestParam(defaultValue="false") boolean includeHidden){return service.list(includeHidden);}
    @PostMapping ResponseEntity<OpenedAccount> open(@RequestHeader(value="Idempotency-Key",required=false) String key,
        @jakarta.validation.Valid @RequestBody OpenAccountRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.open(key,body));
    }
    @GetMapping("/{id}") AccountDetail detail(@PathVariable UUID id){return service.detail(id);}
    @GetMapping("/{id}/transactions") TransactionPage history(@PathVariable UUID id,
        @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate from,
        @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate to,
        @RequestParam(defaultValue="ALL") TransactionType type,@RequestParam(defaultValue="20") int size,
        @RequestParam(required=false) String cursor) {
        return service.history(id,from,to,type,size,cursor);
    }
}

record OpenAccountRequest(@jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Pattern(regexp="[0-9]{4}") String pin,
 @jakarta.validation.constraints.NotBlank String termsVersion){}
