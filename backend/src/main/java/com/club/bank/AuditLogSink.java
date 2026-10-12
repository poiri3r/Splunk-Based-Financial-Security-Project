package com.club.bank;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.AppenderBase;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Synchronous, bounded JSONL file output. Failure never changes the business result. */
@Component
class AuditLogSink {
    private final Logger logger=(Logger)LoggerFactory.getLogger("BANK_AUDIT");
    private final AppenderBase<ILoggingEvent> appender;
    private final ScheduledExecutorService maintenance;
    AuditLogSink(@Value("${bank.audit.directory:${BANK_AUDIT_DIR:./logs}}") String directory) {
        var file=new RollingAuditFile(Path.of(directory),50L*1024*1024,14,1024L*1024*1024,Clock.systemUTC());
        // Initialization errors do not abort demo startup; every write retries and falls back.
        try{file.initialize();}catch(IOException|RuntimeException e){warning();}
        appender=new AppenderBase<>() {
            @Override protected void append(ILoggingEvent event) {
                try{file.append(event.getFormattedMessage());}
                catch(IOException|RuntimeException e){warning();System.err.println(event.getFormattedMessage());}
            }
        };
        appender.setName("AUDIT_JSON_FILE");appender.setContext(logger.getLoggerContext());appender.start();
        logger.setAdditive(false);logger.setLevel(ch.qos.logback.classic.Level.INFO);logger.addAppender(appender);
        maintenance=Executors.newSingleThreadScheduledExecutor(r->{var t=new Thread(r,"audit-retention");t.setDaemon(true);return t;});
        maintenance.scheduleWithFixedDelay(()->{try{file.cleanup();}catch(IOException|RuntimeException e){warning();}},1,1,TimeUnit.HOURS);
    }
    private static void warning(){System.err.println("AUDIT_FILE_UNAVAILABLE: check audit directory permissions and free disk space; business processing continues.");}
    void write(String json){logger.info(json);}
    @PreDestroy void close(){maintenance.shutdownNow();logger.detachAppender(appender);appender.stop();}
}

/** One backend JVM per directory. UTF-8 JSONL, UTC day/size rolling, oldest-first retention. */
final class RollingAuditFile {
    private final Path directory,active;
    private final long maxBytes,totalBytes;
    private final int days;
    private final Clock clock;
    private LocalDate activeDay;
    RollingAuditFile(Path directory,long maxBytes,int days,long totalBytes,Clock clock){
        this.directory=directory;this.active=directory.resolve("audit.log");this.maxBytes=maxBytes;this.days=days;this.totalBytes=totalBytes;this.clock=clock;
    }
    synchronized void initialize()throws IOException {
        try{Files.createDirectories(directory,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwxr-x---")));}
        catch(UnsupportedOperationException e){Files.createDirectories(directory);}
        if(!Files.exists(active))createActive();
        if(activeDay==null)activeDay=Files.getLastModifiedTime(active).toInstant().atZone(ZoneOffset.UTC).toLocalDate();
        // Check actual write access, not only Files.isWritable (ACL/volume permissions may differ).
        try(var ignored=Files.newOutputStream(active,StandardOpenOption.APPEND)){}
        cleanup();
    }
    private void createActive()throws IOException {
        try{Files.createFile(active,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-r-----")));}
        catch(UnsupportedOperationException e){Files.createFile(active);} // Windows: inherited directory ACL
        activeDay=LocalDate.now(clock);
    }
    synchronized void append(String json)throws IOException {
        if(json.indexOf('\n')>=0||json.indexOf('\r')>=0)throw new IOException("Audit event must be one line");
        if(!Files.exists(active))initialize();
        if(activeDay==null)initialize();
        byte[] bytes=(json+"\n").getBytes(StandardCharsets.UTF_8);
        long size=Files.size(active);
        if(size>0&&(!activeDay.equals(LocalDate.now(clock))||size+bytes.length>maxBytes)){
            int index=0;Path archive;
            do{archive=directory.resolve("audit."+activeDay+"."+(index++)+".log");}while(Files.exists(archive));
            Files.move(active,archive);createActive();cleanup();
        }
        long before=Files.size(active);
        try{Files.write(active,bytes,StandardOpenOption.APPEND);}
        catch(IOException error){
            try(var channel=java.nio.channels.FileChannel.open(active,StandardOpenOption.WRITE)){channel.truncate(before);}
            catch(IOException ignored){}
            throw error;
        }
    }
    synchronized void cleanup()throws IOException {
        if(!Files.isDirectory(directory))return;
        var archives=new ArrayList<Path>();
        try(var stream=Files.list(directory)){stream.filter(p->p.getFileName().toString().matches("audit\\.\\d{4}-\\d{2}-\\d{2}\\.\\d+\\.log")).forEach(archives::add);}
        archives.sort(Comparator.comparing((Path p)->p.getFileName().toString().substring(6,16))
            .thenComparingLong(p->Long.parseLong(p.getFileName().toString().split("\\.")[2])));
        LocalDate cutoff=LocalDate.now(clock).minusDays(days);
        long total=0;var remaining=new ArrayList<Path>();
        for(Path p:archives){
            LocalDate day=LocalDate.parse(p.getFileName().toString().substring(6,16));
            if(!day.isAfter(cutoff))Files.deleteIfExists(p);
            else{remaining.add(p);total+=Files.size(p);}
        }
        for(Path p:remaining){if(total<=totalBytes)break;long size=Files.size(p);Files.deleteIfExists(p);total-=size;}
    }
}
