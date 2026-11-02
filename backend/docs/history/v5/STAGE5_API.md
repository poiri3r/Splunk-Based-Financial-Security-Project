# 5차 API 계약 — 회원가입·모의 연락처 인증·복구 코드

2026-10-02. 외부 문자/메일 연동 없이 구현한 백엔드 API다. 연락처 인증은 SIMULATED로만 저장하고 실제 소유 확인으로 취급하지 않는다. 계정 복구는 별도로 보관한 무작위 복구 코드로 수행한다. 모의 수신함의 번호로 비밀번호를 재설정할 수 없다.

## 실행 모드

기본 실행은 모의 발송 비활성: contact-challenges는503 DELIVERY_DISABLED, demo/inbox는404. 회원가입(연락처 생략), 복구 코드, 비밀번호 변경/복구는 기본 실행에서도 동작한다.

모의 발송은 `demo-verification` 프로필과 서버 설정 `bank.demo-inbox-key`(32자 이상 비밀값)를 모두 지정해야 한다. 키 누락/짧은 키는 시작 실패. 예: Spring Boot 실행 인자로 `--spring.profiles.active=demo-verification` 및 `--bank.demo-inbox-key=<별도로 생성한 비밀값>`을 지정한다. 암호화 키 BANK_ENCRYPTION_KEY/BANK_LOOKUP_KEY도 기존과 같이 필요하다. 예시 테스트 키를 실제 환경에 사용하지 않는다.

모의 수신함은 별도 프론트 화면이 아닌 개발용 API다. 공유 개발용 키를 일반 프론트 배포 코드나 공개 페이지에 넣지 않는다. 개발자가 요청하거나 개발 전용 서버 중계에서만 사용한다. VerificationSender 인터페이스로 발송을 분리했고 현재 구현체는 비활성/모의 두 개다.

## API 목록

| API | 인증 | 성공 |
|---|---|---|
| GET /api/v2/terms | 공개 | 200 |
| POST /api/v2/contact-challenges | REGISTER 공개, PROFILE 로그인 필요 | 202 |
| POST /api/v2/contact-challenges/{id}/verify | PROFILE은 소유자 로그인 필요 | 200 |
| POST /api/v2/demo/inbox | 개발용 키 + 요청별 inboxToken | 200 (프로필 활성 시만) |
| POST /api/v2/auth/register | 공개, Idempotency-Key 필수 | 201 |
| GET /api/v2/me/terms | 로그인 | 200 |
| PUT /api/v2/me/contact | 로그인 + 현재 비밀번호 | 204 |
| POST /api/v2/me/recovery-codes | 로그인 + 현재 비밀번호 | 200 |
| GET /api/v2/me/recovery-codes | 로그인 | 200 |
| PUT /api/v2/me/password | 로그인 + 현재 비밀번호 | 204 |
| POST /api/v2/recovery/username | 복구 코드 | 200 |
| POST /api/v2/recovery/password | 아이디 + 복구 코드 | 204 |
| POST /api/v2/accounts/{id}/pin/reset | 로그인 + 현재 비밀번호 + 본인 복구 코드 | 204 |

## 1. 약관과 회원가입

GET terms는 `{items:[{id,version,required,text},...]}`. SERVICE/PRIVACY의 현재 버전은 각각2026-10-v1. 본문은 **프로젝트 시연용 약관 초안**이며 실제 서비스용 법률 문서가 아니다. 동의 ID·버전·사용자·시각을 기록한다. 기존 가입자에게 과거 동의를 임의로 만들어 넣지 않는다.

회원가입 예:

```json
{
 "username":"youngwoo","password":"사용자가 정한 12자 이상 비밀번호","name":"김영우",
 "termsVersions":{"SERVICE":"2026-10-v1","PRIVACY":"2026-10-v1"},
 "contactGrant":"연락처 인증을 진행했다면 발급받은 권한"
}
```

헤더 Idempotency-Key는 소문자 표준 UUID. 성공은 `{customerId:"UUID"}`. 같은 키/동일 내용은 동일 결과, 다른 내용은409. 가입용 키는 공개 등록 요청 전용 저장소를 사용한다(로그인 후 거래 키와 별개). 응답에 로그인 토큰/복구 코드가 자동 포함되지 않는다.

아이디 영문·숫자·밑줄3~32자, 비밀번호12~64자 및UTF-8 72바이트 이하, 이름공백제거1~100자/제어문자금지. 현재 필수 약관 두 개에 정확히 동의해야 한다. 연락처는 선택이며 contactGrant 생략 시 연락처 없이 가입할 수 있다. 인증을 진행한 경우 REGISTER 전용 일회용 grant만 허용한다. 이메일/전화번호 중 한 개를 가입 시 적용하며 추가 연락처는 로그인 후 PROFILE 흐름으로 등록한다.

기존 `/api/auth/register`는 호환용 기본 가입으로 남아 있으며 이름·약관·연락처를 강제하지 않는다. 모든 가입 경로에 새 약관을 강제한 것으로 간주하지 않는다. 프론트 전환 후 구 가입 경로 폐기는 별도 협의한다.

## 2. 모의 인증번호

발급:

```json
{"purpose":"REGISTER","channel":"EMAIL","contact":"Young@example.com"}
```

purpose REGISTER 또는 PROFILE, channel EMAIL 또는 SMS. EMAIL은 도메인만 소문자화하며 로컬 부분은 유지한다. SMS는 공백/하이픈을 제거하고 국내0 시작 번호를 +82로 정규화한다. PROFILE은 로그인 사용자에 묶인다.

```json
{"challengeId":"UUID","expiresAt":"UTC 시각","delivery":"SIMULATED","inboxToken":"요청별 무작위 비밀 토큰"}
```

인증번호 자체는 이 응답에 없다. 6자리 SecureRandom 번호, 유효5분. DB에는 연락처/모의수신내용 암호문, 비교용 HMAC, inboxToken SHA-256 해시를 저장한다.

개발용 수신 확인: POST demo/inbox에 `X-Demo-Inbox-Key` 헤더와 아래 본문을 보낸다.

```json
{"challengeId":"UUID","inboxToken":"발급 응답에서 받은 토큰"}
```

응답 `{code:"482193",assurance:"SIMULATED"}`. 키와 요청별 토큰이 모두 맞아야 하며 전체 수신함 목록/연락처별 검색은 제공하지 않는다. 만료·확인 완료·폐기된 요청은 조회할 수 없다.

검증: POST contact-challenges/{id}/verify에 `{code:"482193"}`. 성공은 `{contactGrant,expiresAt,assurance:"SIMULATED"}`. 코드 확인은 한 번만 가능하며, 성공 즉시 모의수신 암호문을 삭제한다. grant는 검증부터5분, 용도/사용자에 묶여 한 번 적용할 수 있다.

- 연속5회 잘못된 번호면 해당 요청 폐기. 실패 횟수는 오류 응답에서도 DB에 남는다.
- 동일 목적·채널·연락처는 재발송 간격60초, 시간당최대10회.
- 재발송 시 같은 사용자 범위의 이전 요청/미사용 grant도 폐기한다.
- 발급은IP별30회/60초, 검증은IP별60회/60초. 애플리케이션이 보는 실제 원격 주소를 사용하며 임의 X-Forwarded-For를 신뢰하지 않는다. 프록시 환경은 마지막 통합에서 제한 정책을 조정한다.
- 목적 변경 또는 PROFILE 타인 사용은 거절한다. SMS도 실제 문자가 나가지 않는다.

## 3. 로그인 후 연락처 적용

PROFILE challenge를 발급/검증하고 아래를 PUT me/contact로 보낸다.

```json
{"currentPassword":"현재 로그인 비밀번호","contactGrant":"PROFILE 전용 권한"}
```

해당 채널만 변경하며 다른 연락처는 유지한다. 내 정보 응답에 emailAssurance/phoneAssurance가 추가된다. 값은 UNVERIFIED 또는 SIMULATED이며 emailVerified/phoneVerified는 계속false다. 일반 프로필 PUT으로 연락처 값을 변경하거나 지우면 해당 assurance는 UNVERIFIED로 돌아간다. 연락처가 같으면 기존 assurance를 유지한다.

SIMULATED 연락처는 계정 복구 수단으로 사용하지 않는다. 실제 발송/실제 검증 모드는 이번에 구현하지 않았다.

## 4. 복구 코드 발급·회전

로그인 후 POST me/recovery-codes:

```json
{"currentPassword":"현재 로그인 비밀번호"}
```

응답 `{codes:["코드1",...,"코드5"],oneTimeDisplay:true}`. 각 코드는 무작위32바이트를 URL-safe Base64로 표현한43자 문자열이다. DB에는 SHA-256 해시만 저장한다. 발급을 다시 호출하면 이전 미사용 코드도 모두 폐기하고 새5개를 발급한다.

GET me/recovery-codes는 `{remaining:5}`처럼 남은 수만 반환한다. 원문 재조회/복호화 API가 없다. 응답을 놓쳤으면 로그인 상태에서 재발급한다. 코드는 자동 만료하지 않으며 소비·회전·자격 증명 변경으로 폐기된다. 사용자가 비밀번호 관리자 등 별도 장소에 보관한다.

로그인한 민감한 identity 작업(코드발급,연락처적용,비밀번호변경,PIN복구)은 사용자별 합계5회/300초 제한. 설정/이체 step-up 제한과 별개다. identity 제한은 DB에 저장한다.

## 5. 아이디 찾기와 비밀번호 복구

아이디 찾기 POST recovery/username:

```json
{"recoveryCode":"보관한 코드 하나"}
```

성공 `{username:"youngwoo"}`. 해당 코드를 소비하며 나머지 코드는 유지한다. 복구 코드의 소유를 확인했으므로 이 단계에서는 실제 로그인 아이디를 반환한다. 이름·이메일·전화번호로 계정 목록을 검색하는 기능은 제공하지 않는다.

비밀번호 복구 POST recovery/password:

```json
{"username":"youngwoo","recoveryCode":"사용하지 않은 코드","newPassword":"새로운 12자 이상 비밀번호"}
```

204 성공. 코드가 연결된 사용자와 아이디가 맞아야 한다. 실패는 공통 RECOVERY_INVALID로 응답한다. 성공하면 비밀번호를 BCrypt로 변경하고 모든 로그인 토큰, 이체/설정 승인 토큰, PROFILE 연락처 권한, 남은 복구 코드를 폐기한다. 다시 로그인해서 새 복구 코드를 발급한다.

두 복구 API 합계IP별20회/시간, 비밀번호 복구는 요청 아이디별5회/시간도 제한한다. 실제 존재 여부와 관계없이 같은 규칙을 적용한다. 코드검증/사용자일치 실패도 제한에 집계한다. 계정 잠금 자체를 설정하는 기능은 아니므로 정상 로그인은 별도다.

## 6. 로그인 비밀번호 변경과 PIN 분실 재설정

PUT me/password:

```json
{"currentPassword":"기존 로그인 비밀번호","newPassword":"새로운 12자 이상 비밀번호"}
```

204 성공 후 현재 세션을 포함해 모든 세션/승인/복구 코드가 폐기된다. 새 비밀번호로 재로그인한다.

POST accounts/{id}/pin/reset:

```json
{"currentPassword":"로그인 비밀번호","recoveryCode":"본인 복구 코드","newPin":"7391"}
```

본인 계좌만 가능하며 로그인 비밀번호와 본인 미사용 복구 코드가 둘 다 필요하다. 기존 PIN을 몰라도 재설정할 수 있다. 잠금/실패 횟수를 초기화하고 계좌 설정 버전/보안 버전을 올린다. 성공 시 모든 세션/승인/복구 코드도 폐기하므로 재로그인/새 복구 코드 발급이 필요하다. 정상 PIN 변경은 기존 PUT pin을 계속 사용한다.

로그인 비밀번호와 PIN을 둘 다 잊었다면 복구 코드 하나로 로그인 비밀번호를 복구 → 재로그인 → 새 복구 코드 발급 → 새 코드로 PIN 재설정 순서다. **복구 코드까지 모두 잃으면 셀프서비스 복구가 불가능하다.** 관리자 우회 초기화 API는 추가하지 않았다.

## 7. 원자성·토큰 폐기·동시성

identity 작업과 구·신 로그인/가입은 DB의 identity mutex를 사용해 순서를 정한다. 자격 증명 변경은 그 다음 사용자/계좌를 잠그며 다른 송금의 사용자→계좌 잠금 순서와 호환된다. 같은 복구 코드의 동시 사용은 한 번만 성공한다. 비밀번호 복구와 이전 비밀번호 로그인 경합에서도 먼저 발급된 토큰은 복구 시 폐기되고, 나중 로그인은 새 비밀번호로 검사한다.

사용자/로그인 토큰에 authVersion을 추가했다. 필터는 버전을 비교하며 주요 변경·공통 송금/입금은 사용자 잠금 후 다시 확인한다. 이미 완료된 거래를 취소하거나 모든 진행 중 읽기 응답을 강제로 중단하는 기능은 아니다. 성공한 기존 이체의 기록은 삭제하지 않는다.

identity mutex는 정확성을 우선한 전역 직렬화다. 실제 배포 전 부하 테스트와 사용자/연락처별 잠금 세분화 검토가 필요하다. H2 메모리 DB 재시작은 데이터를 보존하지 않으며, 이 기능의 코드/제한 지속성은 실제 사용하는 DB의 저장 방식에 따른다.

## 8. 오류·마이그레이션

기존 오류 외에 DELIVERY_DISABLED(503), RATE_LIMITED(429), CHALLENGE_INVALID/CODE_INVALID/CHALLENGE_LOCKED/RECOVERY_INVALID(400), CONTACT_GRANT_INVALID(403), TERMS_VERSION_REQUIRED(409). 현재 비밀번호 오류는 REAUTHENTICATION_FAILED(401)이며 로그인 토큰 만료와 구분한다.

V1~V9는 그대로 두고 V10을 추가한다. 기존 사용자의 연락처 상태는 UNVERIFIED, authVersion은0, 기존 토큰 버전도0으로 유지한다. 기존 약관 동의/복구 코드는 만들어 넣지 않는다. 사용자가 직접 발급해야 한다. plaintext 비밀번호/PIN/복구 코드/승인 토큰은 저장하지 않는다. 모의 OTP만 개발 수신함 제공을 위해 확인 전까지 암호화 저장한다.
