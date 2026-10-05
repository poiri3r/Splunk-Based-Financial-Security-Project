package com.club.bank;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import java.time.*;
import java.util.*;
record AccountSettings(String accountId,String alias,boolean hidden,int order,boolean debitEnabled,
    boolean pinConfigured,boolean pinLocked,Instant pinLockedUntil,long version){}
record PinIntent(@NotNull @PositiveOrZero Long version,@NotNull @Pattern(regexp="[0-9]{4}") String newPin){}
record DebitIntent(@NotNull @PositiveOrZero Long version,@NotNull Boolean enabled){}
record LimitsIntent(@NotNull @PositiveOrZero Long version,
    @JsonDeserialize(using=MoneyStringDeserializer.class) @NotNull @Pattern(regexp="(0|[1-9][0-9]{0,16})(\\.[0-9]{1,2})?") String perTransfer,
    @JsonDeserialize(using=MoneyStringDeserializer.class) @NotNull @Pattern(regexp="(0|[1-9][0-9]{0,16})(\\.[0-9]{1,2})?") String daily){}
record PinChangeRequest(@Valid @NotNull PinIntent changes,@NotBlank @Size(max=128) String actionToken,
    @Pattern(regexp="[0-9]{4}") String currentPin){}
record DebitChangeRequest(@Valid @NotNull DebitIntent changes,@NotBlank @Size(max=128) String actionToken){}
record LimitsChangeRequest(@Valid @NotNull LimitsIntent changes,@NotBlank @Size(max=128) String actionToken){}
record LimitsView(String customerId,String perTransfer,String daily,String usedToday,String remainingDaily,LocalDate date,long version){}
record BeneficiaryRequest(@NotBlank @Pattern(regexp="LOCAL") String bankCode,
    @NotBlank @Pattern(regexp="[0-9]{10,20}") String accountNumber,@Size(max=50) String alias){}
record BeneficiaryAliasRequest(@NotNull @PositiveOrZero Long version,@Size(max=50) String alias){}
record BeneficiaryView(String id,String bankCode,String accountNumber,String alias,Instant createdAt,long version){}
record BeneficiaryList(List<BeneficiaryView> items){}
