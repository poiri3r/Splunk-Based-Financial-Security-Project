package com.club.bank;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.*;

record ReceiverRequest(@NotBlank @Pattern(regexp="LOCAL") String bankCode,
                       @NotBlank @Pattern(regexp="[0-9]{10,20}") String accountNumber) {}
record ReceiverView(String bankCode,String maskedAccountNumber,String receiverName,boolean nameVerified) {}
record PreviewRequest(@NotNull UUID fromAccountId,@NotBlank @Pattern(regexp="LOCAL") String bankCode,
                      @NotBlank @Pattern(regexp="[0-9]{10,20}") String toAccountNumber,
                      @com.fasterxml.jackson.databind.annotation.JsonDeserialize(using=MoneyStringDeserializer.class) @NotNull @Pattern(regexp="(0|[1-9][0-9]{0,16})(\\.[0-9]{1,2})?") String amount,
                      @Size(max=100) String memo) {}
record TransferSnapshot(String fromAccountId,String fromAccountNumber,String bankCode,
                        String toAccountNumber,String receiverName,boolean nameVerified,String memo) {}
record PreviewView(String previewId,TransferSnapshot details,String amount,String fee,String currency,Instant expiresAt) {}
record StepUpRequest(@NotBlank @Size(max=64) String password,@NotBlank @Pattern(regexp="TRANSFER|ACCOUNT_PIN|DEBIT_SETTING|TRANSFER_LIMITS") String purpose,@NotNull UUID targetId,
    @Pattern(regexp="[0-9]{4}") String pin,com.fasterxml.jackson.databind.JsonNode changes) {}
record StepUpView(String actionToken,Instant expiresAt,String authenticationMethod) {}
record ExecuteTransferRequest(@NotNull UUID previewId,@NotBlank @Size(max=128) String actionToken) {}
record TransferResult(String transferId,String status,String previewId,TransferSnapshot details,
                      String amount,String fee,String currency,String balanceAfter,Instant createdAt) {}
record TransferPage(List<TransferResult> items,String nextCursor,boolean hasNext,LocalDate from,LocalDate to) {}
