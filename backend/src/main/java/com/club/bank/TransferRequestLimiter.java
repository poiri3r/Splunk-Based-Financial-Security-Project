package com.club.bank;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.http.HttpStatus;
/** Single-process guard. Multi-instance deployment needs a shared gateway/Redis limit. */
@Component
class TransferRequestLimiter {
    private record Window(long until,int count) {}
    private final Map<String,Window> windows=new HashMap<>();
    synchronized void check(Long user,String purpose,int maximum,int seconds) {
        long now=Instant.now().getEpochSecond();
        windows.entrySet().removeIf(e->e.getValue().until()<=now);
        String key=user+":"+purpose;Window old=windows.get(key);
        if(old==null && windows.size()>=10000 || old!=null && old.count()>=maximum)
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,"RATE_LIMITED","잠시 후 다시 시도해 주세요.");
        windows.put(key,new Window(old==null?now+seconds:old.until(),old==null?1:old.count()+1));
    }
}
