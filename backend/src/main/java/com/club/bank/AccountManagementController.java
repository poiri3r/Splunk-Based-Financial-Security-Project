package com.club.bank;
import java.util.UUID;
import jakarta.validation.Valid;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
@RestController @RequestMapping("/api/v2")
class AccountManagementController {
    private final AccountManagementService management;private final BeneficiaryService beneficiaries;
    AccountManagementController(AccountManagementService management,BeneficiaryService beneficiaries){this.management=management;this.beneficiaries=beneficiaries;}
    @GetMapping("/accounts/{id}/preferences") AccountSettings settings(@PathVariable UUID id){return management.settings(id);}
    @PatchMapping("/accounts/{id}/preferences") AccountSettings preferences(@PathVariable UUID id,@RequestBody JsonNode r){return management.preferences(id,r);}
    @PutMapping("/accounts/{id}/debit-setting") AccountSettings debit(@PathVariable UUID id,@Valid @RequestBody DebitChangeRequest r){return management.debit(id,r);}
    @PutMapping("/accounts/{id}/pin") AccountSettings pin(@PathVariable UUID id,@Valid @RequestBody PinChangeRequest r){return management.pin(id,r);}
    @GetMapping("/me/transfer-limits") LimitsView limits(){return management.limits();}
    @PutMapping("/me/transfer-limits") LimitsView limits(@Valid @RequestBody LimitsChangeRequest r){return management.limits(r);}
    @GetMapping("/beneficiaries") BeneficiaryList beneficiaries(){return beneficiaries.list();}
    @PostMapping("/beneficiaries") @ResponseStatus(HttpStatus.CREATED) BeneficiaryView add(@Valid @RequestBody BeneficiaryRequest r){return beneficiaries.add(r);}
    @PatchMapping("/beneficiaries/{id}") BeneficiaryView update(@PathVariable UUID id,@Valid @RequestBody BeneficiaryAliasRequest r){return beneficiaries.update(id,r);}
    @DeleteMapping("/beneficiaries/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) void delete(@PathVariable UUID id,@RequestParam long version){beneficiaries.delete(id,version);}
}
