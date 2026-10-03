package com.club.bank;
import jakarta.validation.constraints.*;
import java.util.*;
record ChallengeRequest(@NotBlank @Pattern(regexp="REGISTER|PROFILE") String purpose,
 @NotBlank @Pattern(regexp="EMAIL|SMS") String channel,@NotBlank @Size(max=254) String contact){}
record VerifyChallengeRequest(@NotBlank @Pattern(regexp="[0-9]{6}") String code){}
record DemoInboxRequest(@NotNull UUID challengeId,@NotBlank @Size(max=128) String inboxToken){}
record ExtendedRegisterRequest(@NotBlank @Pattern(regexp="[a-zA-Z0-9_]{3,32}") String username,
 @NotBlank @Size(min=12,max=64) String password,@NotBlank @Size(max=100) String name,
 @NotNull Map<String,String> termsVersions,@NotBlank @Size(max=128) String contactGrant){}
record ContactApplyRequest(@NotBlank @Size(max=64) String currentPassword,@NotBlank @Size(max=128) String contactGrant){}
record PasswordCheckRequest(@NotBlank @Size(max=64) String currentPassword){}
record PasswordChangeRequest(@NotBlank @Size(max=64) String currentPassword,@NotBlank @Size(min=12,max=64) String newPassword){}
record PinResetRequest(@NotBlank @Size(max=64) String currentPassword,@Size(max=128) String recoveryCode,
 @Size(max=128) String contactGrant,@NotBlank @Pattern(regexp="[0-9]{4}") String newPin){}
