package com.club.bank;
import java.time.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class StepUpLimiterTest {
 static class Time extends Clock {
  long millis=1_000_000;public ZoneId getZone(){return ZoneOffset.UTC;}
  public Clock withZone(ZoneId z){return this;}public Instant instant(){return Instant.ofEpochMilli(millis);}
  public long millis(){return millis;}
 }
 @Test void successesDoNotSpendOrResetFailureBudgetAndBlockDoesNotSlide(){
  Time t=new Time();var l=new StepUpLimiter(t);
  for(int i=0;i<4;i++){l.request(1L);assertEquals("REAUTHENTICATION_FAILED",assertThrows(ApiException.class,()->l.verify(1L,()->false)).error.code());}
  for(int i=0;i<7;i++){l.request(1L);l.verify(1L,()->true);}
  l.request(1L);assertEquals(300,assertThrows(StepUpRateLimited.class,()->l.verify(1L,()->false)).retryAfter);
  t.millis+=120_000;assertEquals(180,assertThrows(StepUpRateLimited.class,()->l.request(1L)).retryAfter);
  assertThrows(StepUpRateLimited.class,()->l.verify(1L,()->{fail("blocked password must not be checked");return true;}));
  l.request(2L);l.verify(2L,()->true);
  t.millis+=180_000;l.request(1L);l.verify(1L,()->true);
 }
 @Test void totalRequestWindowAndFailureWindowExpireAtBoundary(){
  Time t=new Time();var l=new StepUpLimiter(t);
  for(int i=0;i<30;i++){l.request(1L);l.verify(1L,()->true);}
  assertEquals(60,assertThrows(StepUpRateLimited.class,()->l.request(1L)).retryAfter);
  t.millis+=59_001;assertEquals(1,assertThrows(StepUpRateLimited.class,()->l.request(1L)).retryAfter);
  t.millis+=999;l.request(1L);l.verify(1L,()->true);
  for(int i=0;i<4;i++){l.request(2L);assertThrows(ApiException.class,()->l.verify(2L,()->false));}
  t.millis+=300_000;l.request(2L);assertEquals("REAUTHENTICATION_FAILED",assertThrows(ApiException.class,()->l.verify(2L,()->false)).error.code());
 }
 @Test void concurrentRequestsCannotOverrunRequestOrPasswordFailureBudget()throws Exception{
  var l=new StepUpLimiter(new Time());var pool=Executors.newFixedThreadPool(8);var allowed=new AtomicInteger();var checked=new AtomicInteger();
  try{
   var tasks=new java.util.ArrayList<Callable<Void>>();
   for(int i=0;i<60;i++)tasks.add(()->{try{l.request(1L);allowed.incrementAndGet();}catch(StepUpRateLimited ignored){}return null;});
   for(var f:pool.invokeAll(tasks))f.get();assertEquals(30,allowed.get());tasks.clear();
   for(int i=0;i<15;i++)tasks.add(()->{try{l.request(2L);l.verify(2L,()->{checked.incrementAndGet();return false;});}catch(ApiException ignored){}return null;});
   for(var f:pool.invokeAll(tasks))f.get();assertEquals(5,checked.get());
  }finally{pool.shutdownNow();}
 }
}
