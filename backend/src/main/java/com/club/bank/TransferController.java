package com.club.bank;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
@RestController @RequestMapping("/api/v2")
class TransferController {
    private final TransferService transfers;private final AccountManagementService management;
    TransferController(TransferService transfers,AccountManagementService management){this.transfers=transfers;this.management=management;}
    @PostMapping("/transfers/receiver-validation") ReceiverView receiver(@Valid @RequestBody ReceiverRequest r){return transfers.receiver(r);}
    @PostMapping("/transfers/previews") @ResponseStatus(HttpStatus.CREATED)
    PreviewView preview(@Valid @RequestBody PreviewRequest r){return transfers.preview(r);}
    @PostMapping("/auth/step-up") StepUpView stepUp(@Valid @RequestBody StepUpRequest r){return "TRANSFER".equals(r.purpose())?transfers.stepUp(r):management.authorize(r);}
    @PostMapping("/transfers") TransferResult execute(@Valid @RequestBody ExecuteTransferRequest r,@RequestHeader(value="Idempotency-Key",required=false) String key){return transfers.execute(r,key);}
    @GetMapping("/transfers/{id}") TransferResult get(@PathVariable UUID id){return transfers.get(id);}
    @GetMapping("/transfers") TransferPage list(
        @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate from,
        @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate to,
        @RequestParam(defaultValue="20") int size,@RequestParam(required=false) String cursor){return transfers.list(from,to,size,cursor);}
}
