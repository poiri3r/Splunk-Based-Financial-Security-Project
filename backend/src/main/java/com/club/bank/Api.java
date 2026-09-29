/*
 * Api.java: 은행 API의 입력·출력 형식, 업무 처리, HTTP 주소를 모은 파일.
 * 읽는 순서: BankController(요청 접수) → BankService(처리) → Repository(DB).
 * import: 라이브러리 사용 선언 / class: 데이터와 기능을 묶는 단위 / record: 값 묶음.
 * String: 문자열 / Long: 정수 / BigDecimal: 정확한 십진수 금액 / Instant: 시각.
 * 메서드: 이름(...) 형태의 기능 / return: 결과 반환 / new: 객체 생성 / ;: 문장 끝.
 * public: 외부에서 호출 가능 / private: 해당 클래스 안에서 사용 / void: 반환값 없음.
 * 이 파일은 DMZ의 화면 코드가 아니라 내부망 API 서버에서 실행된다.
 */
package com.club.bank;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.*;
import org.springframework.security.authentication.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.security.SecureRandom;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
// 로그인 요청 JSON의 username과 password를 받는다. @NotBlank는 빈 값·공백만 있는 값을 거절한다.
record LoginRequest(@NotBlank String username,@NotBlank String password) {
}
// 로그인 응답. expiresIn은 문자열이 아닌 정수로 직렬화한다.
record LoginResponse(String token,String tokenType,long expiresIn) {}
// 회원가입 입력. 아이디는 영문·숫자·밑줄 3~32자, 비밀번호는 12~64자.
// @Pattern은 정규식 규칙, @Size는 길이 규칙이다. request.username()으로 값을 꺼낸다.
record RegisterRequest(@NotBlank @Pattern(regexp="[a-zA-Z0-9_]{3,32}") String username, @NotBlank @Size(min=12,max=64) String password) {
}
// 가상 입금 입력: 계좌번호와 금액. @NotNull은 값 누락, @DecimalMin은 0.01 미만을 막는다.
record DepositRequest(@NotBlank String accountNumber,@NotNull @DecimalMin("0.01") BigDecimal amount) {
}
// 송금 입력: 출금계좌, 입금계좌, 금액. 계좌 소유자는 요청에서 받지 않고 로그인 정보로 판단한다.
record TransferRequest(@NotBlank String fromAccount,@NotBlank String toAccount,@NotNull @DecimalMin("0.01") BigDecimal amount) {
}
// 계좌 응답에 필요한 번호와 잔액만 공개한다. 사용자 비밀번호나 토큰은 포함하지 않는다.
record AccountView(String number,BigDecimal balance) {
}
// 거래내역 응답: 거래 ID, 상대 계좌/거래 출처, 금액, 생성 시각.
record EntryView(String transferId,String counterparty,BigDecimal amount,Instant createdAt) {
}
// @Service는 Spring이 이 업무 처리 객체를 만들어 관리하도록 지정한다.
@Service class BankService {
    // static final은 클래스가 공유하는 참조를 한 번 설정한다는 뜻. 계좌번호 생성용 난수 도구.
    private static final SecureRandom ACCOUNT_RANDOM = new SecureRandom();
    // final 필드는 생성자에서 연결한 객체 참조를 다시 바꾸지 않는다. users는 사용자 DB 담당.
    private final UserRepo users;
    // accounts는 계좌 DB 담당. 잔액 조회와 행 잠금을 수행한다.
    private final AccountRepo accounts;
    // ledger는 입출금 내역 DB 담당.
    private final LedgerRepo ledger;
    // tokens는 로그인 토큰 해시와 만료 시각 DB 담당.
    private final TokenRepo tokens;
    // encoder는 비밀번호를 해시로 만들고 입력값과 비교하는 도구.
    private final PasswordEncoder encoder;
    private final EntityManager entityManager;
    private final IdempotencyRepo idempotency;
    private static final BigDecimal MAX_BALANCE = new BigDecimal("99999999999999999.99");
    // 클래스 이름과 같은 생성자. Spring이 준비한 DB 도구들을 인자로 전달한다. 이를 의존성 주입이라고 한다.
    BankService(UserRepo u,AccountRepo a,LedgerRepo l,TokenRepo t,PasswordEncoder e,EntityManager em,IdempotencyRepo i) {
        users=u;
        accounts=a;
        ledger=l;
        tokens=t;
        encoder=e;
        entityManager=em;
        idempotency=i;
    }
    // 현재 요청에서 인증된 사용자를 찾는 내부 공통 함수.
    private BankUser current() {
        // 보안 필터가 저장한 인증 주체를 꺼낸다. Object는 여러 종류의 값을 담을 수 있는 상위 타입이다.
        var authentication=SecurityContextHolder.getContext().getAuthentication();
        Object principal=authentication==null?null:authentication.getPrincipal();
        // instanceof는 타입 검사. Long이면 id라는 이름으로 사용한다. !는 부정, if는 조건문.
        // 인증된 사용자 ID가 아니면 throw로 처리를 중단하고 HTTP 401을 응답한다.
        if (!(principal instanceof Long id)) throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","로그인이 필요하거나 토큰이 만료되었습니다.");
        // DB에서도 사용자를 확인한다. orElseThrow는 값이 없을 때 예외를 발생시키는 함수.
        // () -> ... 는 나중에 실행할 짧은 함수(람다)다.
        return users.findById(id).orElseThrow(()->new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","로그인이 필요하거나 토큰이 만료되었습니다."));
    }
    // 회원가입. @Transactional은 이 메서드의 DB 작업을 하나로 묶는다. 실패하면 변경을 되돌린다.
    @Transactional public void register(RegisterRequest request) {
        // BCrypt 입력 한도 때문에 UTF-8 기준 72바이트를 넘는 비밀번호를 거절한다. 글자 수와 바이트 수는 다를 수 있다.
        if(request.password().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>72) throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","비밀번호는 UTF-8 기준 72바이트 이하여야 합니다.","password");
        // isPresent()는 조회 결과가 있다는 뜻. 같은 아이디가 있으면 HTTP 409(충돌)를 반환한다.
        if(users.findByUsername(request.username()).isPresent()) throw new ApiException(HttpStatus.CONFLICT,"DUPLICATE_USERNAME","이미 사용 중인 아이디입니다.");
        try {
            // 비밀번호를 해시로 바꾼 사용자 객체를 DB에 기록한다. Flush는 SQL을 DB에 즉시 반영하는 단계이며 최종 확정은 트랜잭션 종료 때다.
            users.saveAndFlush(new BankUser(request.username(),encoder.encode(request.password())));
        }
        // try 안에서 DB 제약 오류가 나면 catch에서 처리한다. 동시 가입의 중복 아이디도 DB UNIQUE가 막는다.
        // 현재 구현은 이 종류의 DB 오류를 모두 아이디 중복으로 응답한다.
        catch(org.springframework.dao.DataIntegrityViolationException ex) {
            throw new ApiException(HttpStatus.CONFLICT,"DUPLICATE_USERNAME","이미 사용 중인 아이디입니다.");
        }
    }
    // 계좌 개설. 사용자 지정 잔액이나 소유자 ID를 받지 않으며 로그인한 본인에게 만든다.
    @Transactional public AccountView openAccount() {
        // 요청 본문 대신 검증된 로그인 정보에서 소유자를 결정한다.
        BankUser owner=current();
        // 2로 시작하는 16자리 계좌번호. %015d는 앞자리를 0으로 채워 15자리 정수로 표시한다.
        // DB UNIQUE가 중복 저장을 막지만, 현재 코드는 번호 충돌 시 재시도하지 않는다.
        String number="2"+String.format(java.util.Locale.ROOT,"%015d",ACCOUNT_RANDOM.nextLong(1_000_000_000_000_000L));
        // 새 계좌를 잔액 0.00으로 저장한다. new Account(...)는 계좌 객체 생성이다.
        Account account=accounts.saveAndFlush(new Account(number,owner,BigDecimal.ZERO.setScale(2)));
        // 전체 DB 객체 대신 계좌번호와 잔액만 응답에 담는다.
        return new AccountView(account.number,account.balance);
    }
    // 로그인 성공 응답은 LoginResponse로 자료형을 고정한다.
    @Transactional public LoginResponse login(LoginRequest request) {
        // 아이디로 사용자를 찾는다. orElse(null)은 결과가 없으면 null(값 없음)을 넣는다.
        BankUser u=users.findByUsername(request.username()).orElse(null);
        // ==는 같은지 비교, ||는 또는, !는 부정. 사용자가 없거나 비밀번호가 다르면 401.
        // 앞 조건이 참이면 뒤 조건은 실행하지 않아 null의 필드를 읽는 오류를 피한다.
        if(u==null || request.password().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>72 || !encoder.matches(request.password(),u.passwordHash)) throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","아이디 또는 비밀번호가 올바르지 않습니다.");
        // 무작위 UUID 두 개를 연결해 토큰을 만든다. 이 토큰은 JWT가 아니라 DB에서 확인하는 임의 문자열이다.
        String token=UUID.randomUUID().toString()+UUID.randomUUID();
        // 원본 토큰의 SHA-256 해시, 사용자, 현재부터 8시간 뒤인 만료 시각을 저장한다.
        tokens.save(new AuthToken(SecurityConfig.hash(token),u,Instant.now().plus(Duration.ofHours(8))));
        // expiresIn은 초 단위 JSON 정수다. 원본 토큰은 로그인 응답으로만 반환한다.
        return new LoginResponse(token,"Bearer",28800);
    }
    // 본인 계좌 목록. List는 여러 항목의 목록이고 readOnly는 조회용 트랜잭션이라는 의미다.
    @Transactional(readOnly=true) public List<AccountView> list() {
        // 본인 ID로 조회 → stream으로 항목 처리 → map으로 응답 형태 변환 → toList로 목록 생성.
        // a -> ... 에서 a는 처리 중인 계좌 한 개다.
        return accounts.findByOwnerIdOrderById(current().id).stream().map(a->new AccountView(a.number,a.balance)).toList();
    }
    // 계좌가 실제로 존재하며 로그인 사용자의 소유인지 확인하는 공통 함수.
    private Account owned(String n) {
        // 계좌번호로 조회한다. 없으면 HTTP 404.
        Account a=accounts.findByNumber(n).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","계좌가 없거나 접근할 수 없습니다."));
        // equals는 값 비교. 남의 계좌도 404로 응답해 존재 여부를 드러내지 않는다.
        if(!a.owner.id.equals(current().id)) throw new ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","계좌가 없거나 접근할 수 없습니다.");
        return a;
    }
    // 잔액 조회. 먼저 owned()로 계좌 소유권을 확인한다.
    @Transactional(readOnly=true) public AccountView balance(String n) {
        // 소유권 확인을 통과해야 아래 조회·응답을 수행한다.
        Account a=owned(n);
        // 전체 DB 객체 대신 계좌번호와 잔액만 응답에 담는다.
        return new AccountView(a.number,a.balance);
    }
    // 본인 거래내역 조회. 반환값은 EntryView 목록이다.
    @Transactional(readOnly=true) public List<EntryView> history(String n) {
        // 소유권 확인을 통과해야 아래 조회·응답을 수행한다.
        Account a=owned(n);
        // 최신 거래부터 조회하고 외부에 필요한 필드만 응답으로 만든다.
        return ledger.findByAccountIdOrderByCreatedAtDescIdDesc(a.id).stream().map(e->new EntryView(e.transferId,e.counterparty,e.amount,e.createdAt)).toList();
    }
    // 시연용 가상 입금: 외부 은행에서 돈을 받지 않고 본인 잔액을 증가시킨다.
    // 현재 이 API는 demo 프로필 전용이 아니며 인증된 사용자가 호출할 수 있다.
    private String validKey(String key) {
        if(key==null) throw new ApiException(HttpStatus.BAD_REQUEST,"IDEMPOTENCY_KEY_INVALID","Idempotency-Key 헤더가 필요합니다.");
        try {
            String canonical=UUID.fromString(key).toString();
            if(!canonical.equals(key)) throw new IllegalArgumentException();
            return canonical;
        } catch(IllegalArgumentException ex) {
            throw new ApiException(HttpStatus.BAD_REQUEST,"IDEMPOTENCY_KEY_INVALID","Idempotency-Key는 소문자 표준 UUID 형식이어야 합니다.");
        }
    }
    // 사용자 행 잠금 후 기존 결과를 조회한다. 같은 사용자의 동시 재시도는 첫 요청의 커밋을 기다린다.
    private IdempotencyRecord previous(BankUser user,String key,String hash,String operation) {
        users.findLockedById(user.id).orElseThrow(()->new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","로그인이 필요하거나 토큰이 만료되었습니다."));
        IdempotencyRecord existing=idempotency.findByUserIdAndRequestKey(user.id,key).orElse(null);
        if(existing!=null && (!existing.requestHash.equals(hash) || !existing.operation.equals(operation)))
            throw new ApiException(HttpStatus.CONFLICT,"IDEMPOTENCY_KEY_CONFLICT","같은 키가 다른 요청에 사용되었습니다.");
        return existing;
    }
    @Transactional public Map<String,String> deposit(DepositRequest r,String requestKey) {
        // scale()은 소수 자릿수. 세 자리 이상이면 400(잘못된 요청)을 반환한다.
        if(r.amount().scale()>2) throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","금액은 소수점 둘째 자리까지만 입력할 수 있습니다.","amount");
        String key=validKey(requestKey);
        BankUser user=current();
        String hash=SecurityConfig.hash("deposit|"+r.accountNumber()+"|"+r.amount().setScale(2).toPlainString());
        IdempotencyRecord old=previous(user,key,hash,"DEPOSIT");
        if(old!=null) return Map.of("depositId",old.resultId,"status","completed","source","simulated_cash");
        // 가상 입금을 요청한 계좌가 로그인 사용자의 계좌인지 먼저 확인한다.
        Account account=owned(r.accountNumber());
        // 해당 계좌 DB 행에 쓰기 잠금을 요청한다. 잠금은 트랜잭션이 끝날 때 해제된다.
        // 동시 입금·송금의 정확성은 별도 동시성 테스트로 검증해야 한다.
        Account locked=accounts.findLockedById(account.id).orElseThrow();
        entityManager.refresh(locked,LockModeType.PESSIMISTIC_WRITE);
        // BigDecimal.add는 더한 새 값을 반환한다. 이 줄에서는 아직 필드에 대입하지 않는다.
        BigDecimal balance=locked.balance.add(r.amount());
        // compareTo 결과가 0보다 크면 왼쪽 값이 더 크다. DB 금액 칸의 최대 범위를 넘지 않게 검사한다.
        if(balance.compareTo(MAX_BALANCE)>0) throw new ApiException(HttpStatus.CONFLICT,"BALANCE_LIMIT_EXCEEDED","입금 계좌의 잔액 상한을 초과합니다.");
        // DB에서 관리 중인 객체의 잔액을 수정한다. JPA가 트랜잭션 확정 시 변경 내용을 DB에 기록한다.
        locked.balance=balance;
        // 이번 거래를 구분하는 임의 ID를 만든다.
        String id=UUID.randomUUID().toString();
        // 가상 입금 내역을 저장한다. 잔액 변경과 내역 저장은 같은 트랜잭션에 포함된다.
        ledger.save(new LedgerEntry(locked,"SIMULATED_CASH_DEPOSIT",r.amount(),id));
        idempotency.save(new IdempotencyRecord(user,key,hash,"DEPOSIT",id));
        // 처리 ID와 가상 입금이라는 출처를 응답한다.
        return Map.of("depositId",id,"status","completed","source","simulated_cash");
    }
    // 송금: 출금·입금 잔액과 거래내역 두 건을 하나의 트랜잭션으로 처리한다.
    @Transactional public Map<String,String> transfer(TransferRequest r,String requestKey) {
        // 같은 계좌로 보내는 요청은 거절한다.
        if(r.fromAccount().equals(r.toAccount())) throw new ApiException(HttpStatus.BAD_REQUEST,"SAME_ACCOUNT","출금 계좌와 입금 계좌가 같습니다.");
        // scale()은 소수 자릿수. 세 자리 이상이면 400(잘못된 요청)을 반환한다.
        if(r.amount().scale()>2) throw new ApiException(HttpStatus.BAD_REQUEST,"INVALID_INPUT","금액은 소수점 둘째 자리까지만 입력할 수 있습니다.","amount");
        String key=validKey(requestKey);
        BankUser user=current();
        String hash=SecurityConfig.hash("transfer|"+r.fromAccount()+"|"+r.toAccount()+"|"+r.amount().setScale(2).toPlainString());
        IdempotencyRecord old=previous(user,key,hash,"TRANSFER");
        if(old!=null) return Map.of("transferId",old.resultId,"status","completed");
        // 출금계좌를 조회한다. 없으면 404.
        Account source=accounts.findByNumber(r.fromAccount()).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","출금 계좌가 없거나 접근할 수 없습니다."));
        // 입금계좌를 조회한다. 없으면 404.
        Account target=accounts.findByNumber(r.toAccount()).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","입금 계좌를 찾을 수 없습니다."));
        // 서로 반대 방향 송금에서도 작은 DB ID부터 잠근다. 잠금 순서를 맞춰 교착 가능성을 줄이는 의도다.
        Account first=accounts.findLockedById(Math.min(source.id,target.id)).orElseThrow();
        // 그다음 큰 ID의 계좌를 잠근다.
        Account second=accounts.findLockedById(Math.max(source.id,target.id)).orElseThrow();
        // 조회 시점부터 잠금 획득까지 다른 거래가 끝났을 수 있으므로 DB의 최신 잔액을 다시 읽는다.
        entityManager.refresh(first,LockModeType.PESSIMISTIC_WRITE);
        entityManager.refresh(second,LockModeType.PESSIMISTIC_WRITE);
        // 조건 ? 참일때값 : 거짓일때값 형태의 삼항 연산자. 잠금 순서와 무관하게 출금·입금계좌를 다시 구분한다.
        Account from=first.id.equals(source.id)?first:second, to=first.id.equals(target.id)?first:second;
        // 출금계좌 소유권을 내부 API에서 다시 검사한다. DMZ에서 왔다는 이유만으로 승인하지 않는다.
        if(!from.owner.id.equals(current().id)) throw new ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","출금 계좌가 없거나 접근할 수 없습니다.");
        // 잔액이 송금액보다 작으면 409로 거절한다.
        if(from.balance.compareTo(r.amount())<0) throw new ApiException(HttpStatus.CONFLICT,"INSUFFICIENT_BALANCE","잔액이 부족합니다.");
        if(to.balance.add(r.amount()).compareTo(MAX_BALANCE)>0) throw new ApiException(HttpStatus.CONFLICT,"BALANCE_LIMIT_EXCEEDED","입금 계좌의 잔액 상한을 초과합니다.");
        // 출금계좌에서 금액을 뺀다. subtract는 뺄셈이다.
        from.balance=from.balance.subtract(r.amount());
        // 입금계좌에 금액을 더한다. 성공 시 두 변경이 함께 확정된다.
        to.balance=to.balance.add(r.amount());
        // 이번 거래를 구분하는 임의 ID를 만든다.
        String id=UUID.randomUUID().toString();
        // 출금 내역은 negate()로 음수 금액을 기록한다.
        ledger.save(new LedgerEntry(from,to.number,r.amount().negate(),id));
        // 입금 내역은 양수 금액을 기록한다. 두 내역은 동일한 거래 ID로 연결된다.
        ledger.save(new LedgerEntry(to,from.number,r.amount(),id));
        idempotency.save(new IdempotencyRecord(user,key,hash,"TRANSFER",id));
        // 송금 처리 결과를 응답한다.
        return Map.of("transferId",id,"status","completed");
    }
}
// HTTP 요청을 받는 창구. @RestController는 반환값을 JSON 등 HTTP 응답으로 변환한다.
// @RequestMapping("/api")는 아래 모든 경로 앞에 /api를 붙인다.
@RestController @RequestMapping("/api") class BankController {
    // 실제 업무 처리를 담당할 서비스 객체를 보관한다.
    private final BankService service;
    // Spring이 서비스 객체를 생성자에 전달한다.
    BankController(BankService s) {
        service=s;
    }
    // POST /api/auth/register: 회원가입. @RequestBody는 JSON 읽기, @Valid는 입력 규칙 검사.
    // ResponseEntity<Void>는 상태코드를 지정하되 응답 본문은 없다는 뜻이다.
    @PostMapping("/auth/register") ResponseEntity<Void> register(@Valid @RequestBody RegisterRequest r) {
        service.register(r);
        // 회원가입 성공: HTTP 201 Created. 로그인 토큰은 로그인 API에서 별도로 받는다.
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }
    // POST /api/auth/login: 입력을 검증하고 서비스의 로그인 함수에 전달한다.
    @PostMapping("/auth/login") LoginResponse login(@Valid @RequestBody LoginRequest r) {
        return service.login(r);
    }
    // POST /api/accounts: 인증된 사용자의 새 계좌를 만든다. 응답은 201과 계좌정보.
    @PostMapping("/accounts") ResponseEntity<AccountView> openAccount() {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.openAccount());
    }
    // GET /api/accounts: 로그인 사용자의 계좌 목록. 같은 주소라도 GET과 POST의 역할이 다르다.
    @GetMapping("/accounts") List<AccountView> accounts() {
        return service.list();
    }
    // GET /api/accounts/계좌번호/balance. @PathVariable은 주소의 {number} 값을 꺼낸다.
    @GetMapping("/accounts/{number}/balance") AccountView balance(@PathVariable String number) {
        return service.balance(number);
    }
    // GET /api/accounts/계좌번호/transactions: 본인 거래내역.
    @GetMapping("/accounts/{number}/transactions") List<EntryView> history(@PathVariable String number) {
        return service.history(number);
    }
    // POST /api/deposits: 본인 계좌 가상 입금. @Valid 검사가 서비스 호출 전에 수행된다.
    @PostMapping("/deposits") Map<String,String> deposit(@Valid @RequestBody DepositRequest r,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        return service.deposit(r,key);
    }
    // POST /api/transfers: 본인 계좌에서 다른 계좌로 송금.
    @PostMapping("/transfers") Map<String,String> transfer(@Valid @RequestBody TransferRequest r,@RequestHeader(value="Idempotency-Key",required=false) String key) {
        return service.transfer(r,key);
    }
}
