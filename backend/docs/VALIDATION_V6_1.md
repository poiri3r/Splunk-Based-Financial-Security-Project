# v6.1 검증 결과

검증일: 2026-10-03 UTC. 실행 환경: OpenJDK 17.0.20, Maven 3.9.9.

`mvn clean package` 성공. 총 **90건, 실패 0, 오류 0, 건너뜀 0**. 기존 73건에 v6.1 회귀 테스트 17건을 추가했습니다. 의존성이 준비된 작업 환경에서 `-o`와 별도 Maven 로컬 저장소 경로를 사용했습니다.

## 테스트 집계

| 클래스 | 테스트 | 실패 | 오류 | 건너뜀 |
|---|---:|---:|---:|---:|
| com.club.bank.AccountManagementMigrationTest | 1 | 0 | 0 | 0 |
| com.club.bank.EncryptedStorageIntegrationTest | 2 | 0 | 0 | 0 |
| com.club.bank.EncryptionMigrationTest | 1 | 0 | 0 | 0 |
| com.club.bank.FieldCryptoTest | 2 | 0 | 0 | 0 |
| com.club.bank.MigratedSchemaIntegrationTest | 2 | 0 | 0 | 0 |
| com.club.bank.SavingsMathTest | 2 | 0 | 0 | 0 |
| com.club.bank.Stage6ProductsIntegrationTest | 9 | 0 | 0 | 0 |
| com.club.bank.Stage6ProductsMigratedIntegrationTest | 9 | 0 | 0 | 0 |
| com.club.bank.StepUpLimiterTest | 3 | 0 | 0 | 0 |
| com.club.bank.V61IntegrationTest | 7 | 0 | 0 | 0 |
| com.club.bank.V61MigratedIntegrationTest | 7 | 0 | 0 | 0 |
| com.club.bank.V6ApiIntegrationTest | 22 | 0 | 0 | 0 |
| com.club.bank.V6MigratedApiIntegrationTest | 22 | 0 | 0 | 0 |
| com.club.bank.VerificationDisabledTest | 1 | 0 | 0 | 0 |

## 새 검증 내용

- 7개 멱등 API의 키 누락/잘못된 형식 → 통일된 HTTP 400 코드.
- 변경·복구의 길이, UTF-8 바이트 길이, 정책 위반, 기존 비밀번호 재사용 → `field=newPassword`. 가입은 `password`.
- 이체와 계좌 설정을 번갈아 실패해도 공유 제한. 성공 시 실패 횟수 유지, 5번째 실패 429 및 Retry-After 300. 로그인 잠금과 분리.
- 가상 시계로 1분/5분 경계, 제한 중 요청의 차단 연장 방지, 사용자별 분리 검증. 실제 5분을 기다리는 브라우저 검수는 아님.
- 병렬 호출로 요청 30회 및 비밀번호 비교 5회 상한 검증.
- IP 한도 소진 후 가입 재전송 성공, 새 요청 거절, 동일 키의 약관 변경 충돌, 기존 v6 해시 호환 검증.
- 동시 같은 가입 요청은 사용자·영수증 각 1개.
- 가입 로그 SUCCESS/REPLAY/FAILURE, 원문 민감정보 미포함, 전화번호 HMAC, 위조 전달 IP 무시.
- 실제 트랜잭션 매니저의 커밋/롤백으로 성공 로그 시점 검증. 롤백에는 고객 ID/성공 표시 없음.

## 검증 범위와 남은 연동 확인

통합 테스트는 MockMvc와 H2를 사용합니다. Flyway 테스트는 H2 PostgreSQL 호환 모드에서 SQL 마이그레이션과 JPA 스키마 검증을 수행했습니다. 실제 PostgreSQL 서버, 프론트 브라우저, BFF/프록시, 외부 SMS, Splunk 수집은 실행하지 않았습니다.

프론트 공동 검수에서는 오류 입력란 표시, Retry-After 전달 및 남은 시간 안내, 응답 유실 후 같은 키·본문으로 재전송, 서버 로그 수집 경로를 확인해야 합니다. 기존 이체/PIN/로그인/예적금/암호화 테스트도 함께 회귀 실행했습니다.

실행 JAR: `dist/bank-backend-0.1.0.jar`. 임의 생성한 임시 키와 `demo,demo-verification` 프로필로 별도 프로세스를 기동한 결과는 아래에 기록합니다. 임시 키는 배포물에 포함하지 않습니다.

**JAR 실행 확인 통과:** `java -jar` 기동 후 로컬 `GET /health` → HTTP 200. 확인 후 프로세스를 종료했습니다.
