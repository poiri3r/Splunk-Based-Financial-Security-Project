package com.club.bank;
import jakarta.validation.constraints.*;
record CustomerView(String customerId,String username,String name,String email,String phone,
                    boolean emailVerified,boolean phoneVerified,long version,String emailAssurance,String phoneAssurance,boolean bankingReady) {}
/** PUT replaces these optional fields; null clears a value. Contacts are not verified identities. */
record UpdateCustomerRequest(@NotBlank @Size(max=64) String currentPassword,
    @NotNull @PositiveOrZero Long version,@Size(max=100) String name,
    @Email @Size(max=254) String email,@Size(max=32) String phone) {}
