> v4 역사 자료입니다. 먼저 IMPLEMENTATION_STAGE1.md의 키 설정·마이그레이션 순서를 적용하세요.

# Windows 11 + PostgreSQL 실행 확인

PowerShell을 열고 프로젝트의 `pom.xml`이 있는 폴더로 이동합니다. Java 17 이상과 Maven 설치 확인은 한 줄로 `java -version; mvn -version`을 실행하세요. 둘 중 하나가 인식되지 않으면 해당 프로그램 설치와 PATH 설정 후 PowerShell을 다시 엽니다.

인프라 담당에게 PostgreSQL 접속 호스트·포트, 빈 데이터베이스 이름, 접속 가능한 사용자와 비밀번호를 받습니다. 그 계정에는 최초 테이블·인덱스·Flyway 이력 테이블을 만들 권한이 필요합니다. 인프라 담당은 데이터가 재시작 후에도 남는 영구 저장소와 백업을 준비합니다. `src/main/resources/db/migration/V1__initial_schema.sql`이 테이블 설계의 원본이며, 앱 시작 시 Flyway가 빈 DB에 한 번 적용합니다. 이미 데이터가 있는 DB에는 별도 이관 계획 없이 적용하지 마세요.

아래는 같은 PowerShell 창에서 실행하는 예입니다. 실제 접속 정보로 바꾸고 비밀번호는 공유하거나 저장소에 커밋하지 마세요.

```powershell
$env:SPRING_PROFILES_ACTIVE='postgres'
$env:DB_URL='jdbc:postgresql://localhost:5432/bankdb'
$env:DB_USER='bank_app'
$env:DB_PASSWORD='실제_비밀번호'
mvn spring-boot:run
```

다른 PowerShell 창에서 다음을 순서대로 실행합니다. 각 응답의 HTTP 상태 및 잔액과 거래내역을 확인하세요.

```powershell
$base='http://localhost:8080'
Invoke-RestMethod "$base/health"
$body=@{username='newuser1';password='LongPassword123!'} | ConvertTo-Json
Invoke-RestMethod -Method Post "$base/api/auth/register" -ContentType 'application/json' -Body $body
$login=Invoke-RestMethod -Method Post "$base/api/auth/login" -ContentType 'application/json' -Body $body
$headers=@{Authorization="Bearer $($login.token)"}
$account=Invoke-RestMethod -Method Post "$base/api/accounts" -Headers $headers
$deposit=@{accountNumber=$account.number;amount=10000.00} | ConvertTo-Json
$depositHeaders=$headers.Clone(); $depositHeaders["Idempotency-Key"]=[guid]::NewGuid().ToString()
Invoke-RestMethod -Method Post "$base/api/deposits" -Headers $depositHeaders -ContentType 'application/json' -Body $deposit
Invoke-RestMethod "$base/api/accounts/$($account.number)/balance" -Headers $headers
Invoke-RestMethod "$base/api/accounts/$($account.number)/transactions" -Headers $headers
```

송금 테스트에서는 위 가입·로그인·계좌 개설 과정을 다른 username으로 한 번 더 실행하여 **두 번째 계좌번호**를 얻습니다. 첫 번째 사용자 토큰으로 다음을 실행합니다.

```powershell
$transfer=@{fromAccount=$account.number;toAccount='두번째_계좌번호';amount=3000.00} | ConvertTo-Json
$transferHeaders=$headers.Clone(); $transferHeaders["Idempotency-Key"]=[guid]::NewGuid().ToString()
Invoke-RestMethod -Method Post "$base/api/transfers" -Headers $transferHeaders -ContentType 'application/json' -Body $transfer
Invoke-RestMethod "$base/api/accounts/$($account.number)/balance" -Headers $headers
Invoke-RestMethod "$base/api/accounts/$($account.number)/transactions" -Headers $headers
```

첫 번째 계좌는 7000.00, 두 번째 계좌는 3000.00이어야 합니다. 서버 창에서 `Ctrl+C`로 종료한 뒤 **동일한 DB_URL**로 다시 실행하고 로그인부터 다시 진행해 두 계좌의 잔액과 거래내역이 유지되는지 확인합니다. `demo` 프로필이나 기본 H2 설정으로 실행하면 이 영속성 검증이 되지 않습니다.

같은 요청이 타임아웃되어 재시도할 때는 동일한 `$depositHeaders` 또는 `$transferHeaders`를 재사용하세요. 새로운 거래에는 새 UUID를 발급해야 합니다.
