# 코드 읽기 안내

1. BankApplication.java: 시작점
2. BankController.java: 기존 HTTP 주소와 요청/응답
3. LoginRequest/Response, RegisterRequest, AccountView, EntryView, DepositRequest, TransferRequest: API 데이터 형식
4. BankService.java: 가입·로그인·계좌·입금·송금 업무. 이번 단계에서는 업무별 서비스 추가 분리는 하지 않았습니다.
5. FieldCrypto.java: 개인정보 AES-GCM 암호화·복호화·HMAC 검색
6. BankUser.java, Account.java, LedgerEntry.java: 암호문·검색값 저장 구조
7. UserRepo.java, AccountRepo.java, LedgerRepo.java 등: DB 조회와 계좌 잠금
8. SecurityConfig.java와 TokenFilter.java: BCrypt 설정·로그인 토큰 검증
9. CryptoMetadata.java/Repo.java, CryptoKeyVerifier.java: DB와 실행 키의 일치 확인
10. db/migration/V4__Encrypt_existing_personal_data.java 및 resources/db/migration/V3/V5: 기존 데이터 이전

원래 Api.java·Model.java·Repositories.java는 개별 클래스 파일로 대체됐습니다. ApiError/ApiException/ApiErrors도 각각 분리했습니다. 패키지는 com.club.bank를 유지합니다.

실행 전 IMPLEMENTATION_STAGE1.md, 검증 상태는 VALIDATION.md를 읽으세요.

## 2차 추가 파일

- CustomerController/CustomerService/CustomerDtos: 로그인 연결·내 정보·암호화 프로필·로그아웃
- CurrentCustomer: 인증된 사용자 ID 확인
- AccountQueryController/AccountQueryService/QueryDtos: v2 계좌·거래내역·금액 문자열 변환
- TransactionCursor: 조회 조건에 묶인 페이지 정보 서명·검증
- V6__profile_account_query_fields.sql: 스키마 확장
- Stage2ApiIntegrationTest/Stage2MigratedApiIntegrationTest: H2 자동 스키마와 Flyway 스키마 API 검증


## 3차 단계형 이체 읽는 순서

1. TransferDtos / TransferController: 화면이 주고받는 값과 API 주소.
2. TransferService.preview: 계좌·금액 확인과 5분 암호화 스냅샷.
3. TransferService.stepUp: BCrypt 비밀번호 비교 후 preview 전용 토큰 발급. 토큰 원문은 DB에 저장하지 않음.
4. TransferService.execute: 사용자 잠금, 기존 성공 조회, 권한·만료 확인, 한 트랜잭션으로 실행.
5. TransferEngine.post: 구·신 API가 공유하는 계좌 잠금·잔액 변경·원장 2행 저장.
6. TransferRecord / TransferPreview / TransferAction: 결과, 확인 정보, 일회용 권한을 나누어 저장.
7. Stage3ApiIntegrationTest: 중복 요청·권한·만료·롤백·동시 실행 사례. 같은 테스트를 H2 Flyway 모드에서도 실행.

@Transactional 메서드가 예외로 실패하면 안에서 실행한 DB 변경이 함께 되돌아갑니다. MANDATORY는 이미 시작된 트랜잭션 안에서만 호출해야 한다는 뜻입니다. TransferEngine은 독립 커밋을 만들지 않습니다.


## 4차 계좌 관리 읽는 순서

1. AccountManagementController / AccountManagementDtos: 설정 조회·변경의 주소와 입력/응답.
2. AccountManagementService: 계좌 소유권·설정 버전·로그인 비밀번호 확인, 변경값에 묶인 승인 토큰, 설정 저장.
3. AccountPolicy.verifyPin: BCrypt 비교, 실패 횟수, 15분 잠금. PinFailure만 지정한 진입점에서 롤백하지 않아 실패 횟수를 남김.
4. TransferService.stepUp: 계좌 PIN 설정 시 기존 비밀번호 확인에 PIN 확인을 추가하고 보안 버전을 기록.
5. TransferEngine: 사용자 → 계좌 순서 잠금, 출금 허용·보안 버전·PIN 경로·한도 검사 후 송금. 구 API도 같은 정책 적용.
6. LimitUsage: 사용자/한국 날짜별 성공 송금 사용액. 돈 이동과 함께 커밋 또는 롤백.
7. BeneficiaryService: 사용자별 즐겨찾기, 암호화 번호/별명, 사용자 범위 HMAC 중복 검사.
8. V8 SQL / V9 Java: 구조 추가와 기존 원장의 한국 날짜별 사용액 이전.

계좌 표시 version과 이체 승인용 securityVersion은 별개입니다. 별명만 바꾸면 승인 토큰을 무효화하지 않고, PIN·출금 상태 변경이나 PIN 잠금 진입은 토큰을 무효화합니다.


## 5차 가입·복구 읽는 순서

1. IdentityController/IdentityDtos: API 주소와 입력값.
2. IdentityService.start/verify: 코드 생성, HMAC 비교, 실패/만료, 목적별 일회용 권한.
3. VerificationSender/DemoInboxController: 발송과 검증 분리, 개발 전용 모의 수신함.
4. IdentityService.register: 약관 버전/가입 멱등성/암호화 정보 저장.
5. issue/recovery/resetPassword/resetPin: 별도 보관 코드 발급, 일회성 검증, 자격 증명 재설정.
6. IdentityGate/IdentityRate: DB 잠금·요청 제한. IdentityFailure는 실패 횟수를 남기는 지정 예외.
7. CurrentCustomer.requireFresh/TokenFilter: 로그인 토큰의 인증 버전 검사. 재설정과 로그인은 identity 잠금으로 순서를 맞춤.
8. V10 migration과 Stage5 테스트: 기존 기능 회귀, 모의 인증, 복구 동시 요청 검증.

SIMULATED는 실제 연락처 소유 확인이 아닙니다. OTP6자리 HMAC과256비트 무작위 복구 코드 SHA-256은 서로 다른 비밀과 용도입니다.
