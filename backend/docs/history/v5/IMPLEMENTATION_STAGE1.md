# v5 1차 리팩터링 결과

기준: bank-backendv4. 설계 v2의 구조 분리 및 현재 개인정보 필드 암호화 단계.

## 완료한 변경

- Api.java를 BankController.java, BankService.java와 요청/응답 record 파일로 분리.
- Model.java·Repositories.java·SecurityConfig.java·ApiErrors.java의 여러 클래스를 파일별로 분리. 패키지는 유지.
- 가입 아이디·계좌번호·원장 상대계좌번호(시연 입금 출처 포함)를 AES-256-GCM 암호문으로 저장.
- 아이디·계좌번호 조회 및 중복 판정은 HMAC-SHA-256 검색 칼럼으로 변경.
- 암호화/검색 키 분리, nonce 무작위 생성, 행 UUID와 필드명을 AAD로 결합. 다른 행/필드로 암호문 복사 및 변조는 복호화 실패.
- 서버 시작 시 crypto_metadata 검사로 기존 DB의 키 불일치 거절.
- 기존 비밀번호 BCrypt, 로그인 토큰 SHA-256, 금액 BigDecimal, 계좌 잠금·트랜잭션·멱등 재시도 규칙과 기존 HTTP 계약 유지.
- demo 초기 데이터도 암호화 저장 경로 사용.

## 실행 시 달라지는 점

서버에는 BANK_ENCRYPTION_KEY와 BANK_LOOKUP_KEY가 반드시 필요하다. 서로 다른 32바이트 난수를 Base64로 인코딩한 값이다. 키를 잃으면 데이터를 복구할 수 없다. 기존 DB를 열 때 매번 새 키를 만들면 안 된다.

테스트 Maven 설정에 포함된 공개 fixture 키는 테스트 프로세스에만 주입한다. 앱 실행에는 전달되지 않으며 실제 실행 키로 재사용하지 않는다. Mockito는 agent attach가 필요 없는 subclass 방식으로 설정했다. 실제 HTTP/DB 통합 테스트의 검증 내용은 유지하며, 기존 테스트의 사용자 직접 조회 준비 부분만 HMAC 조회로 바꿨다.

### Windows PowerShell: 첫 H2 시연용 키 생성

```powershell
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$a = New-Object byte[] 32
$b = New-Object byte[] 32
$rng.GetBytes($a)
$rng.GetBytes($b)
$env:BANK_ENCRYPTION_KEY = [Convert]::ToBase64String($a)
$env:BANK_LOOKUP_KEY = [Convert]::ToBase64String($b)
$rng.Dispose()
mvn test
mvn spring-boot:run '-Dspring-boot.run.profiles=demo'
```

이 명령은 키를 출력하지 않는다. H2 메모리 시연에서만 일회성으로 사용한다. PostgreSQL 영구 DB에는 인프라 담당자가 보관·주입하는 고정 키를 사용한다. Git, SQL, README, 화면, 로그에 키를 쓰지 않는다.

## PostgreSQL 이전

기존 V1·V2 SQL은 바이트 단위로 유지했다. V3는 암호문·검색·UUID 칼럼과 키 확인 테이블 추가, Java V4는 기존 행 암호화·복호화 검증·검색값 생성, V5는 필수/고유 제약과 평문 칼럼 제거다. 기본 Flyway 실행은 V3~V5를 순서대로 자동 적용한다.

기존 DB에는 백업/복구 확인 → 모든 구 서버와 쓰기 중단 → 보관된 키 주입 → BANK_ALLOW_PII_MIGRATION=true → 새 버전 1개 인스턴스 시작 순서로 적용한다. 데이터가 있으면 명시적 플래그 없이 V4에서 중단된다. 플래그는 백업을 자동 수행하지 않는다. 빈 DB도 암호화 키는 필요하다.

먼저 복제한 테스트 DB에서 수행한다. 마이그레이션 중 구 바이너리를 함께 실행하지 않는다. 이전 완료 뒤 플래그를 제거하고 단일 인스턴스로 잔액·내역·로그인·기존 멱등 키를 확인한 후 쓰기를 재개한다. Flyway V3가 완료되고 V4가 실패할 수 있으므로 실패 단계와 schema history를 확인한다. 부분 성공 상태에서 평문 칼럼을 수동 삭제하지 않는다.

V5 적용 후 v4 바이너리로 되돌릴 수 없다. 암호화 호환 빌드로 복구하거나 쓰기를 중단한 채 백업 복구·후속 거래 조정이 필요하다. V1/V2의 수동 수정이나 Flyway checksum repair로 이를 해결하지 않는다.

## 현재 한계와 다음 단계

- 고객명·전화·이메일은 기존 v4 모델에 없으므로 이번 버전에 추가하지 않았다. 향후 필드가 생길 때 같은 공통 암호화 모듈을 적용한다.
- 계정 복구·me/logout·신규 /api/v2·KB 화면·한도·자동이체는 다음 기능 단계다. 이번 ZIP은 전체 설계 v2 완성본이 아니다.
- 금액·시각·FK·거래 ID는 계산 가능한 기존 형식을 유지한다. 모든 금융 데이터를 필드 암호화한 것은 아니다.
- 정확한 기존 검색 의미를 유지했다. 아이디 대소문자/공백과 계좌번호 구분자를 자동 정규화하지 않는다.
- 키 버전 v1과 시작 시 키 일치 검사를 지원한다. 다중 키 온라인 회전은 아직 구현하지 않았다. 키를 단순 교체하면 시작이 실패한다.
- 기존 멱등 요청의 SHA-256 hash는 호환성을 위해 유지한다. 신규 HMAC 요청 버전은 후속 API에서 설계한다.
- 기존 계좌번호 URL과 프록시 로그의 개인정보 마스킹은 인프라 설정이 필요하다. 신규 UUID 경로는 후속 API 단계다.
- PostgreSQL 실제 서버 동시성·이전 검증 결과는 VALIDATION.md를 확인한다. H2 결과를 PostgreSQL 보증으로 사용하지 않는다.

## 읽는 순서

BankController → BankService → UserRepo/AccountRepo → BankUser/Account/LedgerEntry → FieldCrypto → CryptoKeyVerifier → V3/V4/V5.

Controller는 요청 창구, Service는 은행 업무, Repository는 DB 조회, Entity는 저장 구조다. FieldCrypto.encrypt는 표시용 암호문, lookup은 같은 값 검색용 HMAC, decrypt는 권한 검사 후 표시할 원문을 복원한다.
