package com.club.bank;
import java.time.Clock;
import java.util.*;
import java.util.function.BooleanSupplier;
import org.springframework.stereotype.Component;
import org.springframework.http.HttpStatus;

/** Single JVM, shared across transfer/settings. Counters deliberately survive transaction rollback.
 * Multiple app instances require a shared limiter; restart clears this local budget. */
@Component class StepUpLimiter {
 private static final long MINUTE=60_000,FIVE_MINUTES=300_000;
 private final Clock clock;
 private final Map<Long,State> states=new HashMap<>();
 private static class State { Deque<Long> requests=new ArrayDeque<>(),failures=new ArrayDeque<>();long blockedUntil,lastSeen; }
 StepUpLimiter(){this(Clock.systemUTC());}
 StepUpLimiter(Clock clock){this.clock=clock;}
 private static void expire(Deque<Long> q,long cutoff){while(!q.isEmpty()&&q.peekFirst()<=cutoff)q.removeFirst();}
 private State state(Long user,long now){
  states.entrySet().removeIf(e->e.getValue().lastSeen+FIVE_MINUTES<=now&&e.getValue().blockedUntil<=now);
  if(!states.containsKey(user)&&states.size()>=10000)throw new StepUpRateLimited(60);
  State s=states.computeIfAbsent(user,k->new State());s.lastSeen=now;
  expire(s.requests,now-MINUTE);expire(s.failures,now-FIVE_MINUTES);return s;
 }
 private static long remaining(State s,long now,boolean request){
  long end=s.blockedUntil;
  if(request&&s.requests.size()>=30)end=Math.max(end,s.requests.peekFirst()+MINUTE);
  return end>now?Math.max(1,(end-now+999)/1000):0;
 }
 synchronized void request(Long user){
  long now=clock.millis();State s=state(user,now);long wait=remaining(s,now,true);
  if(wait>0)throw new StepUpRateLimited(wait);
  s.requests.addLast(now); // rejected requests do not prolong either window
 }
 synchronized void verify(Long user,BooleanSupplier passwordMatches){
  long now=clock.millis();State s=state(user,now);long wait=remaining(s,now,false);
  if(wait>0)throw new StepUpRateLimited(Math.max(wait,remaining(s,now,true)));
  if(passwordMatches.getAsBoolean())return;
  now=clock.millis();expire(s.failures,now-FIVE_MINUTES);s.failures.addLast(now);
  if(s.failures.size()>=5){s.blockedUntil=now+FIVE_MINUTES;throw new StepUpRateLimited(Math.max(300,remaining(s,now,true)));}
  throw new ApiException(HttpStatus.UNAUTHORIZED,"REAUTHENTICATION_FAILED","비밀번호가 올바르지 않습니다.");
 }
}
class StepUpRateLimited extends ApiException {
 final long retryAfter;
 StepUpRateLimited(long seconds){super(HttpStatus.TOO_MANY_REQUESTS,"RATE_LIMITED","잠시 후 다시 시도해 주세요.");retryAfter=seconds;}
}
