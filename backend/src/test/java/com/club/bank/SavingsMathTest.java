package com.club.bank;
import org.junit.jupiter.api.Test;
import java.time.LocalDate;
import java.math.BigDecimal;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
class SavingsMathTest {
 @Test void monthEndAnniversaries(){var d=LocalDate.of(2024,1,31);assertEquals(0,SavingsService.period(d,LocalDate.of(2024,2,28)));assertEquals(1,SavingsService.period(d,LocalDate.of(2024,2,29)));assertEquals(1,SavingsService.period(d,LocalDate.of(2024,3,30)));assertEquals(2,SavingsService.period(d,LocalDate.of(2024,3,31)));}
 @Test void dailySimpleInterestRoundsOnceAfterSumming(){var a=new SavingsPayment();a.amount=new BigDecimal("10000.00");a.paidOn=LocalDate.of(2024,1,1);var b=new SavingsPayment();b.amount=new BigDecimal("10000.00");b.paidOn=LocalDate.of(2024,7,1);assertEquals(new BigDecimal("452.05"),SavingsService.interest(List.of(a,b),LocalDate.of(2025,1,1),new BigDecimal("0.03")));assertEquals(new BigDecimal("0.00"),SavingsService.interest(List.of(a),a.paidOn,new BigDecimal("0.03")));}
}
