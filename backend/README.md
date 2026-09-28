# 은행 백엔드 v3 프론트엔드 연동 수정본

2026-09-28. `bank-backendv3.zip`과 프론트엔드 `추가 합의점` 1~9번을 기준으로 수정했습니다.

## Windows 11 로컬 실행

Java 17 JDK, Maven 3.9 이상을 준비합니다. Maven Wrapper(`mvnw`)는 포함하지 않습니다.
압축을 풀고 **pom.xml이 있는 bank-backend 폴더**에서 PowerShell을 엽니다.

설치 확인 명령 하나:

```powershell
java -version; mvn -version
```

자동 테스트:

```powershell
mvn test
```

초기 데이터 없이 실행:

```powershell
mvn spring-boot:run
```

테스트 계정과 계좌가 필요하면 대신 다음 명령으로 실행합니다.

```powershell
mvn spring-boot:run '-Dspring-boot.run.profiles=demo'
```

처음 빌드에는 Maven 저장소 인터넷 접속이 필요합니다. 서버 터미널은 실행 상태로 두고 다른 PowerShell을 열어 확인합니다.

```powershell
Invoke-RestMethod http://localhost:8080/health
```

`status: ok`는 HTTP 서버 응답 확인입니다. PostgreSQL 연결·영속성 검증은 아닙니다.
종료는 서버 터미널의 Ctrl+C입니다. 포트가 겹치면 실행 전 `$env:PORT='8081'`을 지정하고 호출 URL도 변경합니다.
이전에 설정한 DB_URL, DB_USER, DB_PASSWORD, SPRING_PROFILES_ACTIVE가 있으면 그 설정이 영향을 줍니다. 로컬 H2 테스트에서는 해당 설정이 없는 새 개발 환경을 사용하거나 의도한 값으로 조정합니다.

### 기본 DB와 테스트 데이터

기본값은 H2 **메모리 DB**입니다. API 프로세스를 종료하면 사용자, 토큰, 계좌, 잔액, 거래내역, 중복 요청 기록이 모두 사라집니다. 단순 브라우저 새로고침이나 프론트 종료로 API 프로세스가 종료되지는 않습니다.

| 프로필 | 초기 데이터 |
|---|---|
| 기본 | 없음. 회원가입부터 실행 |
| demo | 사용자 테이블이 비어 있을 때 아래 데이터 생성 |
| postgres | 지정한 외부 PostgreSQL 사용. demo를 함께 켜지 않으면 시드 없음 |

| 아이디 | 비밀번호 | 계좌 | 초기 잔액 |
|---|---|---|---:|
| alice | DemoPass123! | 10010001 | 100000.00 |
| bob | DemoPass456! | 10010002 | 50000.00 |

신규 계좌는 2로 시작하는 16자리 문자열, demo 계좌는 8자리 문자열입니다.

## 프론트엔드 연결

브라우저 → 프론트 Nginx `/api/*` 프록시 → 망연계 → API 서버 → DB 서버.
프론트 fetch는 `/api/...` 상대 경로를 사용합니다. 프록시는 `/api` 접두사, HTTP 메서드, 본문, Authorization, Idempotency-Key, 응답 상태·본문을 보존해야 합니다.

전역 `server.servlet.context-path`는 설정하지 않습니다. 업무 API는 `/api` 아래, 상태 확인은 `/health`입니다. `/error`는 Spring의 내부 오류 처리 경로입니다. CORS 허용 설정은 추가하지 않았습니다. 프론트에서 준비하는 로컬 http-server 프록시와 운영 Nginx 경로는 실제 연동 확인이 필요합니다. `/health`의 전달 여부는 인프라와 별도 합의합니다.

## API 목록

| 기능 | 메서드 | 경로 | 성공 |
|---|---|---|---|
| 회원가입 | POST | /api/auth/register | 201, 본문 없음 |
| 로그인 | POST | /api/auth/login | 200, token/tokenType/expiresIn |
| 계좌 개설 | POST | /api/accounts | 201, number/balance |
| 계좌 목록 | GET | /api/accounts | 200, 배열 |
| 잔액 조회 | GET | /api/accounts/{number}/balance | 200, number/balance |
| 가상 입금 | POST | /api/deposits | 200, depositId/status/source |
| 송금 | POST | /api/transfers | 200, transferId/status |
| 거래내역 | GET | /api/accounts/{number}/transactions | 200, 배열 |
| 상태 확인 | GET | /health | 200, status=ok |

본문은 JSON, Content-Type은 application/json입니다. 회원가입·로그인·health 외에는 `Authorization: Bearer {token}`이 필요합니다. 입금·송금에는 소문자 표준 UUID `Idempotency-Key`도 필수입니다.

로그인 성공 예시:

```json
{"token":"발급받은 토큰","tokenType":"Bearer","expiresIn":28800}
```

expiresIn은 **숫자**, 단위는 초입니다. 토큰은 JWT가 아닌 임의 문자열이고 서버는 DB의 SHA-256 해시와 만료 시각으로 검사합니다. 토큰 누락·형식 오류·알 수 없는 토큰·변조·만료 및 잘못된 로그인 자격증명은 모두 401 UNAUTHORIZED입니다. 필수 로그인 필드 누락 등 요청 검증 오류는 400 INVALID_INPUT입니다. 공개 API에는 토큰이 필요하지 않습니다.

로그아웃 API와 갱신 토큰은 없습니다. 브라우저에서 토큰을 지워도 서버 토큰은 만료 전까지 유효합니다. 만료는 발급 후 8시간이며, 서버의 판단이 최종 기준입니다.

### 공통 오류

```json
{"code":"INSUFFICIENT_BALANCE","message":"잔액이 부족합니다."}
```

```json
{"code":"INVALID_INPUT","message":"입력값의 필수 여부와 형식을 확인해 주세요.","field":"username"}
```

code로 화면을 분기합니다. message는 안내 문구이며 변경될 수 있습니다. field는 특정 가능한 입력 오류에만 포함됩니다. 여러 필드 검증 오류는 필드명 순으로 한 건을 반환합니다. JSON 구문 오류에는 field가 없을 수 있습니다.

| HTTP | code | 의미 |
|---|---|---|
| 400 | INVALID_INPUT | 필수 값·형식·금액·비밀번호 규칙 위반 |
| 400 | SAME_ACCOUNT | 같은 계좌로 송금 |
| 400 | IDEMPOTENCY_KEY_INVALID | 키 누락 또는 잘못된 UUID |
| 401 | UNAUTHORIZED | 로그인 자격증명 또는 토큰 인증 실패 |
| 404 | ACCOUNT_NOT_FOUND | 계좌 없음 또는 접근할 수 없는 계좌 |
| 409 | DUPLICATE_USERNAME | 아이디 중복 |
| 409 | INSUFFICIENT_BALANCE | 출금 잔액 부족 |
| 409 | BALANCE_LIMIT_EXCEEDED | 입금 계좌 잔액 상한 초과 |
| 409 | IDEMPOTENCY_KEY_CONFLICT | 같은 사용자·키에 다른 업무나 입력값 |

HTTP 경로·형식 관련 오류는 NOT_FOUND(404), METHOD_NOT_ALLOWED(405), NOT_ACCEPTABLE(406), UNSUPPORTED_MEDIA_TYPE(415), REQUEST_ERROR(기타 요청 오류)를 사용합니다. 인증 후 별도 접근권한 거부는 FORBIDDEN(403), 예상하지 못한 서버 오류는 INTERNAL_ERROR(500)입니다. 현재 계좌 소유권 위반은 ACCOUNT_NOT_FOUND(404)입니다. 프록시가 직접 만드는 오류는 API 서버 JSON 형식과 다를 수 있으므로 JSON 파싱 실패도 처리합니다.

## 거래와 재시도 규칙

- 금액은 JSON 숫자로 받고 Java BigDecimal로 처리합니다. 최소 0.01, 소수점 최대 두 자리입니다. 10000, 10000.0, 10000.00은 같은 금액입니다.
- 1회 송금 고정 한도는 없습니다. 출금 잔액 이하여야 하고 입금 후 잔액은 최대 99999999999999999.99입니다. 사용자당 계좌 개수 제한도 없습니다.
- JavaScript Number는 큰 금액의 소수 자릿수를 정확히 표현하지 못할 수 있습니다. 현재 숫자 계약으로 DB 최대 범위 전체를 정확하게 다룬다고 보장할 수 없습니다. 실제 허용 범위 축소나 금액 문자열 계약은 팀의 추가 합의가 필요합니다.
- 가상 입금은 로그인 사용자가 자기 계좌에 시연용 잔액을 만드는 기능입니다. 외부 은행 입금 확인 기능은 없습니다.
- 송금 후 출금 계좌를 다시 조회합니다. 입금 계좌는 본인 소유일 때만 다시 조회합니다. 타인 계좌 잔액·거래내역은 404입니다.
- 키 범위는 사용자별입니다. 같은 사용자의 입금·송금은 저장소를 공유합니다. 같은 키로 다른 업무나 입력값을 보내면 409입니다.
- 성공 기록에는 자동 삭제·만료가 없습니다. PostgreSQL 데이터가 유지되는 동안 보존됩니다. H2 메모리 DB는 재시작하면 사라집니다.
- 같은 사용자·키·요청값은 기존 성공 ID와 결과를 반환합니다. 잔액과 내역을 다시 변경하지 않습니다. 실패한 트랜잭션은 기록하지 않습니다.
- 같은 사용자의 동시 거래는 사용자 행 잠금으로 먼저 시작한 DB 트랜잭션의 종료를 기다립니다. 성공 후에는 저장된 결과를 반환하고, 실패로 롤백되면 뒤 요청이 수행될 수 있습니다. 잠금 시간 초과·DB 장애에서는 정상 결과를 보장하지 않습니다. PostgreSQL 동시성 실측은 별도 필요합니다.
- 새 거래에 새 키를 만듭니다. **같은 거래의 결과가 불확실한 네트워크 오류·타임아웃·일부 5xx에서는 같은 키와 같은 본문을 유지**합니다. 성공 응답을 받았으면 거래를 완료 처리합니다. 새 키로 같은 거래를 다시 보내면 신규 거래입니다. 입력 수정은 새 거래 의도로 보고 새 키를 사용합니다. 기존 거래 결과가 불명확하면 먼저 조회·재시도로 확인합니다.

## demo에서 재시도 직접 확인

새 PowerShell에서 실행합니다. 동일한 키를 유지한 두 입금 요청의 depositId가 같고, 잔액이 한 번만 증가해야 합니다.

```powershell
$login = Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/auth/login -ContentType 'application/json' -Body '{"username":"alice","password":"DemoPass123!"}'
$headers = @{ Authorization = "Bearer $($login.token)" }
$key = [guid]::NewGuid().ToString()
$tradeHeaders = $headers + @{ 'Idempotency-Key' = $key }
$body = '{"accountNumber":"10010001","amount":10000}'
Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/deposits -Headers $tradeHeaders -ContentType 'application/json' -Body $body
Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/deposits -Headers $tradeHeaders -ContentType 'application/json' -Body $body
Invoke-RestMethod -Uri http://localhost:8080/api/accounts/10010001/balance -Headers $headers
```

인증 실패 확인은 다음 명령으로 상태코드와 응답 본문을 함께 출력합니다.

```powershell
curl.exe -i http://localhost:8080/api/accounts
```

기대 결과는 HTTP 401과 code=UNAUTHORIZED인 JSON입니다.

## PostgreSQLと担当範囲

인프라 담당: PostgreSQL 서버, DB·접속 계정, 네트워크, 영구 저장소, 백업.
백엔드 담당: 엔티티, V1·V2 테이블 설계, Flyway, API 구현.

```powershell
$env:SPRING_PROFILES_ACTIVE='postgres'
$env:DB_URL='jdbc:postgresql://DB_HOST:5432/bankdb'
$env:DB_USER='DB_ACCOUNT'
$env:DB_PASSWORD='DB_PASSWORD_VALUE'
mvn spring-boot:run
```

실제 환경 값으로 바꾸고 비밀번호는 저장소에 올리지 않습니다. postgres 프로필은 Flyway V1·V2를 적용하고 JPA validate로 구조를 확인합니다. 기존 테이블을 수동 생성한 DB에는 별도 이전 절차가 필요합니다. 이번 변경은 스키마 변경이 없어 기존 V1·V2 SQL을 수정하지 않았습니다.
앱 종료·재실행 후 잔액·내역 유지, 같은 키 재시도 결과 유지, DB 백업 복구는 인프라 준비 후 확인합니다. 구체적인 설명은 docs/WINDOWS11_POSTGRES.md도 참고합니다.

## 파일과 검증 범위

Api.java는 요청·응답과 업무 처리, SecurityConfig.java는 토큰 인증, **ApiErrors.java는 공통 오류 JSON**을 담당합니다. Model.java와 Repositories.java는 DB, DemoData.java는 초기 데이터, Health.java는 상태 확인, BankApplication.java는 시작점입니다.

테스트 소스: IdempotencyIntegrationTest, FrontendContractIntegrationTest. 원본 ZIP 대조, 변경 코드·SQL의 정적 점검은 수행했습니다. 수정본 컴파일·테스트 실행과 PostgreSQL·프록시·Windows 실제 동작은 검증 결과 문서를 확인하세요. 이 문서의 명령과 예시는 실행 결과를 보장하는 기록이 아닙니다.
