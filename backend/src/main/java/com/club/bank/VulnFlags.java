package com.club.bank;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * INTENTIONAL-VULN master switches for the Splunk detection lab.
 *
 * Every flag defaults to FALSE, so a normal build/test and the public repo stay safe:
 * the vulnerable paths only activate when the matching property/env var is set to true.
 * Enable one only inside the isolated lab (IP-restricted) while running an attack scenario.
 *
 *   bank.vuln.idor.enabled              (V-A1)  IDOR/BOLA on account read lookups
 *   bank.vuln.pin-bruteforce.enabled    (V-L2)  weak PIN step-up throttling/lockout
 *   bank.vuln.mass-registration.enabled (V-L1)  weak per-IP registration throttling
 *   bank.vuln.transfer-race.enabled     (V-A2)  transfer without the pessimistic lock
 *
 * Env vars: BANK_VULN_IDOR_ENABLED, BANK_VULN_PIN_BRUTEFORCE_ENABLED,
 *           BANK_VULN_MASS_REGISTRATION_ENABLED, BANK_VULN_TRANSFER_RACE_ENABLED
 */
@Component
class VulnFlags {
    final boolean idor, pinBruteforce, massRegistration, transferRace;
    VulnFlags(
        @Value("${bank.vuln.idor.enabled:false}") boolean idor,
        @Value("${bank.vuln.pin-bruteforce.enabled:false}") boolean pinBruteforce,
        @Value("${bank.vuln.mass-registration.enabled:false}") boolean massRegistration,
        @Value("${bank.vuln.transfer-race.enabled:false}") boolean transferRace) {
        this.idor=idor;this.pinBruteforce=pinBruteforce;this.massRegistration=massRegistration;this.transferRace=transferRace;
    }
}
