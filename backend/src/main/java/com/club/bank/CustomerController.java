package com.club.bank;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import jakarta.validation.Valid;
@RestController @RequestMapping("/api/v2")
class CustomerController {
    private final CustomerService customers;private final BankService bank;private final LoginRate loginRate;
    CustomerController(CustomerService customers,BankService bank,LoginRate loginRate) {this.customers=customers;this.bank=bank;this.loginRate=loginRate;}
    @PostMapping("/auth/login") LoginResponse login(@Valid @RequestBody LoginRequest r,jakarta.servlet.http.HttpServletRequest req) {loginRate.check(req.getRemoteAddr());return bank.login(r);}
    @GetMapping("/auth/me") CustomerView me(){return customers.me();}
    @PutMapping("/me/profile") CustomerView update(@Valid @RequestBody UpdateCustomerRequest r){return customers.update(r);}
    @PostMapping("/auth/logout") ResponseEntity<Void> logout(@RequestHeader("Authorization") String auth) {
        customers.logout(auth);return ResponseEntity.noContent().build();
    }
}
