# v6 백엔드 변경 기록

이 파일은 백엔드 수정본의 사용 설명입니다. 프론트 요청 항목별 회신·프론트 소스 비교 문서는 다음 단계에서 별도로 작성합니다. 상세 요청/응답의 기준은 이 버전의 Controller·DTO와 `V6ApiIntegrationTest`입니다.

## API 정리

업무 API는 `/api/v2`로 통일했습니다. 구 경로 `/api/auth/**`, `/api/accounts/**`, `/api/transfers`, `/api/deposits`는 익명 401, 인증 사용자 403으로 차단됩니다. 기존 서비스 내부 보조 메서드가 남아 있더라도 구 HTTP 경로는 제공하지 않습니다. `/api/v2/recovery/username`의 종전 단일 요청 복구도 제거했습니다.

모의 입금은 `demo` 프로필의 `POST /api/v2/demo/deposits`에서만 제공합니다. Bearer 토큰, UUID `Idempotency-Key`, `accountNumber`, `amount`를 전달합니다. 본인 소유 ACTIVE/CHECKING/KRW 계좌에 적용됩니다. 실제 입금 서비스가 아닙니다.

## 가입과 연락처

1. `GET /api/v2/terms`에서 약관 버전 조회.
2. `POST /api/v2/contact-challenges`: `{ "purpose":"REGISTER", "channel":"SMS", "contact":"01090002951" }` → 202, `challengeId`, `inboxToken`, `expiresAt`.
3. 개발자 전용 `POST /api/v2/demo/inbox`: `X-Demo-Inbox-Key` 헤더와 `{ "challengeId":"...", "inboxToken":"..." }` → 모의 인증번호. 프론트에 공유 키를 배포하지 않습니다.
4. `POST /api/v2/contact-challenges/{id}/verify`: `{ "code":"6자리" }` → `contactGrant`.
5. `POST /api/v2/auth/register`: UUID `Idempotency-Key`와 아래 본문 → 201, `customerId`.

```json
{
  "username":"sample_user",
  "password":"Demo!Sample7392",
  "name":"김시연",
  "termsVersions":{"SERVICE":"2026-10-v1","PRIVACY":"2026-10-v1"},
  "contactGrant":"휴대폰 확인 권한"
}
```

이메일 확인 권한으로 가입할 수 없습니다. 인증번호와 확인 권한은 각각 5분 유효하며 인증번호 5회 오류 시 요청이 잠깁니다. 같은 가입 요청/멱등키의 재전송은 원래 결과를 반환합니다. 다른 요청에 사용한 키는 충돌합니다. 동의 버전과 시각은 DB에 기록합니다.

`PUT /api/v2/me/profile`은 기존 이름 변경 및 휴대폰 변경·삭제를 거부합니다. 기존 이름이 비어 있는 사용자만 이름을 보완할 수 있습니다. 이메일은 변경 시 UNVERIFIED로 저장합니다. 휴대폰 변경은 로그인 후 PROFILE/SMS 확인 권한과 현재 비밀번호를 `PUT /api/v2/me/contact`에 제출합니다. 다른 사용자의 확인 권한은 사용할 수 없습니다. 프로필 비밀번호 재확인은 사용자당 5분 5회로 제한합니다.

`GET /api/v2/auth/me`의 `bankingReady`는 이름과 SIMULATED 휴대폰 확인의 충족 여부입니다. 실명 인증 여부가 아닙니다. 기존 사용자에게 정보 보완 경로를 안내해야 합니다. 누락된 이름 보완 → PROFILE 휴대폰 확인/적용 → 기존 계좌 PIN 설정 후 거래합니다.

## 로그인과 세션

`POST /api/v2/auth/login`의 본문은 `username`, `password`입니다. 로그인 오류 3회째에 423 `LOGIN_LOCKED`가 되고 기존 세션도 폐기합니다. 성공 시 실패 횟수를 초기화합니다. 잠긴 후에는 정답을 입력해도 자동 해제되지 않습니다. IP당 1분 30회 요청을 허용하며 이후 429 `RATE_LIMITED`를 반환합니다. 서버가 보는 원격 주소 기준이므로 프록시를 도입할 때 신뢰 프록시 설정을 별도로 검토해야 합니다.

- 로그인 토큰의 절대 유효 기간은 기존 8시간입니다.
- 추가로 마지막 인증 요청부터 10분이 지나면 만료됩니다.
- `GET /api/v2/auth/session`은 `idleExpiresAt`, `absoluteExpiresAt`, `idleTimeoutSeconds`를 반환하고 시간을 연장하지 않습니다.
- `POST /api/v2/auth/session/extend`는 유효한 세션만 연장합니다. 만료 후 되살릴 수 없습니다.
- 상태 조회 외 인증된 API 요청은 활동으로 처리됩니다. 프론트의 자동 업무 조회도 세션을 연장할 수 있으므로 남은 시간 표시용 폴링에는 session GET을 사용합니다.
- 비밀번호 재설정/변경, 로그인 잠금 해제, PIN 재설정은 기존 로그인과 승인 권한을 폐기하므로 다시 로그인해야 합니다.

## 계정 복구

공개 `POST /api/v2/recovery/verifications`에 다음을 제출합니다.

```json
{
  "purpose":"PASSWORD",
  "method":"ACCOUNT",
  "name":"김시연",
  "accountNumber":"2000000000000001",
  "pin":"4826"
}
```

`purpose`는 `USERNAME`, `PASSWORD`, `LOGIN_UNLOCK`입니다. `USERNAME`이면 아이디를 반환하고, 나머지는 5분짜리 `resetToken`을 반환합니다. 입출금 계좌 소유자의 이름과 PIN을 확인하며 잘못된 PIN은 동일 계좌의 오류 횟수에 반영합니다. 암호화된 이름을 복호화하여 정규화된 입력과 HMAC 비교합니다. 계좌번호 검색도 HMAC을 사용합니다.

- 비밀번호 재설정: `POST /api/v2/recovery/password`, `{ "resetToken":"...", "newPassword":"Demo!Changed7392" }` → 204.
- 로그인 잠금 해제: `POST /api/v2/recovery/login-unlock`, `{ "resetToken":"..." }` → 204.
- 목적이 다른 권한, 만료·재사용 권한, 사용자 보안 버전이 달라진 권한은 거부합니다.
- 복구 증명/재설정/잠금 해제는 각각 IP당 1시간 20회로 제한합니다.
- 선택적 보조 방법은 `{ "purpose":"PASSWORD", "method":"RECOVERY_CODE", "recoveryCode":"..." }`입니다. 계좌 정보와 혼합할 수 없고 코드도 한 번만 사용됩니다.
- 복구 코드 발급은 로그인 후 `POST /api/v2/me/recovery-codes`에 현재 비밀번호를 제출합니다. 원문은 발급 시에만 표시합니다.

계좌가 아직 없거나 PIN도 잠긴 사용자에게는 미리 발급한 복구 코드가 필요합니다. 둘 다 없으면 이 시연 구현만으로는 자가 복구할 수 없습니다. 실제 은행의 영업점·명의 확인 대체 절차는 구현하지 않았습니다.

## 계좌 개설·PIN·한도

`POST /api/v2/accounts`는 UUID `Idempotency-Key`와 `{ "pin":"4826", "termsVersion":"MOCK-CHECKING-2026-v1" }`을 요구합니다. 이름·휴대폰 확인 완료가 필요하며 PIN 해시와 개설 동의 버전/시각을 저장합니다. CHECKING 약관은 가입 약관 목록에서 scope=ACCOUNT_OPEN이며 가입 시에는 required=false지만 개설 API에서는 필수입니다.

PIN은 4자리 숫자입니다. 4회 오류 후 시간 경과로 풀리지 않습니다. 설정 응답은 `pinLocked=true`, `pinLockedUntil=null`이므로 프론트에서 시간제 자동 해제를 가정하면 안 됩니다. PIN 미설정/잠금 계좌는 출금 거래가 차단됩니다.

일반 변경은 기존 `ACCOUNT_PIN` 단계 인증과 현재 PIN을 요구합니다. 예전 데이터의 PIN 미설정 계좌는 현재 PIN 없이 최초 설정할 수 있지만 로그인 및 비밀번호 단계 인증은 필요합니다. 분실·잠금 재설정은 `POST /api/v2/accounts/{id}/pin/reset`에 다음을 제출합니다.

```json
{
  "currentPassword":"현재 로그인 비밀번호",
  "contactGrant":"PROFILE/SMS로 현재 등록된 휴대폰을 확인한 권한",
  "newPin":"7391"
}
```

`contactGrant` 대신 `recoveryCode`를 사용할 수 있으며 둘 중 정확히 하나가 필요합니다. 다른 번호의 확인 권한으로는 재설정할 수 없습니다. 재설정 후 다시 로그인합니다.

로그인 비밀번호는 12~64자, UTF-8 72바이트 이내, 영문·숫자·특수문자 조합입니다. 4자리 이상 동일/연속 패턴과 전화번호 끝 4자리 사용 등을 거부합니다. 신규 PIN도 연속·반복 및 전화번호에 포함된 4자리를 거부합니다. 기존 로그인 비밀번호 자체를 일괄 무효화하지는 않으며 새 설정/변경/복구 시 정책을 적용합니다.

기본 한도는 1회 100만원/1일 500만원이고 PC 설정 API는 감액만 허용합니다. DB의 기존 null 한도에도 기본값을 채웁니다. 계좌 별명·숨김·정렬·자주 쓰는 계좌·조회·이체 승인/실행 흐름은 유지합니다.

## 저장과 마이그레이션

비밀번호/PIN은 BCrypt, 고엔트로피 로그인·복구·행위 토큰은 SHA-256 해시로 저장합니다. 복원이 필요한 개인정보는 기존 AES-GCM 암호화를 유지하고 정확 일치 검색은 별도 키의 HMAC으로 처리합니다. 일반 해시로 개인정보를 대체하지 않습니다. 부분 검색은 제공하지 않습니다.

V1~V11은 수정하지 않고 V12를 추가했습니다. V12는 로그인 실패 횟수·활동 시각·복구 권한·개설 동의 필드를 추가하고 기존 로그인 토큰을 삭제하여 재로그인을 요구합니다. 기존 시간제 PIN 잠금은 명시적 해제 방식으로 전환합니다. 기존 잔액·원장·개설 당시 알 수 없는 동의 내역을 임의로 생성하지 않습니다.

기존 지속 DB에는 원래 암호화 키를 보존한 상태에서 Flyway로 V12를 적용해야 합니다. JPA update만으로는 기존 토큰 폐기/한도/PIN 잠금 전환 데이터 작업을 대신할 수 없습니다. 현재 실행 기본값은 신규 로컬 메모리 DB용입니다. 실제 DB 병합·운영 전환은 이번에 실행하지 않았습니다.

## 유지·제외 항목

예적금은 기존 모의 상품 조회·가입·수동 납입·견적·해지 기능을 유지하고 거래 전 정보 완성/PIN 정책을 적용합니다. 실제 KB 상품 조건·중도해지 계산·금리·세금과 완전히 동일하다고 보장하지 않습니다. 자동이체·공과금·외환·펀드·대출, 실명·실제 SMS·인증서·OTP는 추가하지 않았습니다.
