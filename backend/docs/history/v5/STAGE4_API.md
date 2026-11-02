# 4차 API 계약 — 계좌 관리·계좌 비밀번호·이체한도

2026-10-02. 1~3차를 포함한 누적 구현이다. 아래 숫자·잠금·한도는 이 프로젝트의 시연 정책이며 실제 KB 은행 정책을 재현한 값이 아니다. 공과금·외환·펀드·대출은 제외한다.

공통: 로그인 Bearer 토큰 필수, 외부 계좌/사용자 ID는 UUID, 금액은 문자열, 시간은 UTC ISO 8601. 설정 변경은 version을 검사한다. 타인 계좌/즐겨찾기는 404. PIN 원문·해시·실패 횟수는 응답하지 않는다.

## 1. 계좌 표시 설정

| API | 성공 | 역할 |
|---|---|---|
| GET /api/v2/accounts/{id}/preferences | 200 | 현재 계좌 설정 |
| PATCH /api/v2/accounts/{id}/preferences | 200 | 별명·숨김·순서 일부 변경 |
| GET /api/v2/accounts?includeHidden=true | 200 | 숨긴 계좌까지 포함한 관리 목록 |

응답 예:

```json
{
  "accountId":"11111111-1111-4111-8111-111111111111",
  "alias":"생활비","hidden":false,"order":0,"debitEnabled":true,
  "pinConfigured":true,"pinLocked":false,"pinLockedUntil":null,"version":1
}
```

PATCH 예:

```json
{"version":1,"alias":"생활비","hidden":true,"order":10}
```

- version 필수. 나머지는 생략 시 유지, alias:null은 별명 삭제. 변경 필드가 하나 이상 있어야 한다.
- 별명은 공백 제거 후 1~50자, 제어문자 금지. AES-GCM으로 저장한다.
- hidden은 Boolean, order는 0~9999 정수. 목록은 order → 내부 ID 오름차순.
- 기본 v2 목록과 구 `/api/accounts` 목록은 숨긴 계좌를 제외한다. 관리 화면은 includeHidden=true를 사용한다.
- 숨김은 표시 설정이다. 본인 상세·내역 접근과 이체를 차단하지 않는다.
- v2 계좌 목록·상세에 `preferences` 객체를 추가했다. 기존 필드는 유지한다.
- availableBalance는 비활성·출금 해제·PIN 잠금 시 0.00, 그 외 현재 잔액이다. 1회/1일 한도를 반영한 최대 송금액은 아니므로 한도 API도 확인한다.

## 2. 민감한 설정 변경 승인

기존 `POST /api/v2/auth/step-up`을 확장한다. 로그인 비밀번호를 확인하고 사용자·목적·대상·버전·변경값에 묶인 일회용 actionToken을 발급한다.

| purpose | targetId | changes |
|---|---|---|
| ACCOUNT_PIN | 본인 accountId | `{version,newPin}` |
| DEBIT_SETTING | 본인 accountId | `{version,enabled}` |
| TRANSFER_LIMITS | 본인 customerId | `{version,perTransfer,daily}` |
| TRANSFER | 본인 previewId | changes 미사용; PIN 설정 시 최상위 pin 필요 |

설정 승인 예:

```json
{
  "password":"로그인 비밀번호",
  "purpose":"DEBIT_SETTING",
  "targetId":"11111111-1111-4111-8111-111111111111",
  "changes":{"version":1,"enabled":false}
}
```

```json
{"actionToken":"일회용 토큰","expiresAt":"2026-10-02T11:05:00Z","authenticationMethod":"PASSWORD_RECHECK"}
```

설정 토큰은 발급부터 5분. 원문 대신 SHA-256 토큰 해시와 HMAC 변경값 지문만 저장한다. 새 PIN을 포함한 changes 원문은 DB에 저장하지 않는다. 변경값을 바꾸면 새 승인이 필요하다. 성공 시 토큰을 소비하며 잘못된 대상·목적·변경값·만료·재사용은 403 ACTION_TOKEN_INVALID다. stale version은 409 VERSION_CONFLICT가 먼저 반환될 수 있다.

TRANSFER와 설정 승인 모두 기존 사용자별 step-up 제한(성공/실패 합계 5회/300초)을 공유한다. 이 제한은 단일 서버 메모리 기반이며, PIN 실패/잠금은 별도로 DB에 보존된다.

최종 설정 요청은 **동일한 changes와 actionToken**을 전달한다. 설정 변경에는 Idempotency-Key를 사용하지 않는다. 응답이 유실되면 GET으로 최신 상태/버전을 확인한다.

## 3. 출금 등록·해제

`PUT /api/v2/accounts/{id}/debit-setting` → 200 계좌 설정 객체.

```json
{"changes":{"version":1,"enabled":false},"actionToken":"승인 토큰"}
```

- enabled=false이면 구·신 이체 API 모두 출금을 거절한다. 입금 수취와 본인 조회는 허용한다.
- 해제 후 재등록할 때도 로그인 비밀번호 재확인과 새 토큰이 필요하다.
- 변경하면 기존 이체 승인 토큰이 무효가 된다. 해제했다 다시 등록해도 이전 토큰을 재사용할 수 없다.
- 호환 정책: 기존 계좌와 신규 개설 계좌 모두 최초 debitEnabled=true. 별도 등록 화면을 거치도록 강제한 정책은 아니다. 사용자가 해제·재등록하는 기능을 제공한다.

## 4. 계좌 비밀번호(PIN)

`PUT /api/v2/accounts/{id}/pin` → **200 계좌 설정 객체**. 초기 설계의 204 초안을 최신 상태를 돌려주는 200으로 확정했다.

최초 설정: 먼저 ACCOUNT_PIN 목적으로 `{version:0,newPin:"4826"}`를 승인받는다.

```json
{"changes":{"version":0,"newPin":"4826"},"actionToken":"승인 토큰"}
```

기존 PIN 변경: 로그인 비밀번호 재확인 + 변경 토큰 + 현재 PIN이 모두 필요하다.

```json
{
  "changes":{"version":1,"newPin":"7391"},
  "actionToken":"새 변경값에 대한 승인 토큰",
  "currentPin":"4826"
}
```

- PIN은 숫자 4자리(선행 0 허용) 계좌별 비밀번호다. 앱 로그인용 간편 PIN과 다르다.
- BCrypt 해시만 저장한다. PIN 표시·복호화·조회 API는 없다.
- 등록 이후 변경에서 currentPin 생략은 403 ACCOUNT_PIN_REQUIRED. 로그인 비밀번호만으로 기존 PIN을 덮어쓸 수 없다.
- 올바른 형식의 잘못된 PIN은 실패 횟수를 DB에 누적한다. 변경과 이체 인증이 같은 계좌 카운터를 공유한다.
- 1~4회 실패: 403 PIN_INVALID. 5회째: 423 PIN_LOCKED, 15분 잠금. 잠긴 동안 올바른 PIN도 거절한다.
- 잠금 시간이 지나면 올바른 PIN으로 다시 인증할 수 있다. 성공 시 카운터/잠금 시각 초기화. 만료 후 첫 오입력은 새 연속 실패 횟수 1로 시작한다.
- 실패 응답이어도 실패 횟수·잠금은 커밋된다. PIN 변경값·승인 토큰 소비는 실패 시 반영하지 않는다.
- PIN 설정·변경 또는 잠금 진입 시 기존 이체 승인 토큰을 무효화한다. 잠금 해제 후에도 새 이체 승인이 필요하다.
- PIN은 선택적으로 설정한다. 미설정 계좌는 기존 로그인 비밀번호 재확인 흐름을 유지한다.
- 분실 PIN 재설정/관리자 해제는 아직 제공하지 않는다. 후속 계정 복구 절차와 별도로 연결할 예정이며 일반 프로필 수정으로 해제하지 않는다.

PIN 설정 계좌의 이체 승인 예:

```json
{
  "password":"로그인 비밀번호","purpose":"TRANSFER",
  "targetId":"22222222-2222-4222-8222-222222222222","pin":"4826"
}
```

성공 authenticationMethod는 PASSWORD_AND_ACCOUNT_PIN. 미설정 계좌는 PASSWORD_RECHECK. 이후 `/api/v2/transfers` 실행 본문은 기존 previewId/actionToken 그대로다. 비밀번호 둘을 확인하는 것이며 별도 인증 장치에 의한 MFA로 표시하지 않는다.

구 `/api/transfers`는 PIN 확인 계약이 없으므로 **PIN 설정 계좌의 새 송금을 403 ACCOUNT_PIN_REQUIRED로 차단**한다. 이미 성공했던 같은 키/본문 재시도는 기존 결과만 돌려주며 추가 차감하지 않는다.

## 5. 자주 쓰는 계좌

| API | 성공 | 입력 |
|---|---|---|
| GET /api/v2/beneficiaries | 200 | `{items:[...]}` |
| POST /api/v2/beneficiaries | 201 | bankCode,accountNumber,alias |
| PATCH /api/v2/beneficiaries/{id} | 200 | version,alias |
| DELETE /api/v2/beneficiaries/{id}?version=0 | 204 | 현재 version |

```json
{"bankCode":"LOCAL","accountNumber":"2000000000000001","alias":"회비"}
```

항목 응답: `{id,bankCode,accountNumber,alias,createdAt,version}`.

- LOCAL 내부 은행만 지원, 숫자 계좌번호 10~20자리, 별명 선택/최대50자.
- 계좌번호·별명은 암호화하고 중복 비교는 사용자 범위 HMAC으로 한다. 같은 사용자의 같은 은행·계좌 중복 등록은 409 BENEFICIARY_EXISTS.
- 사용자별 최대100개(초과409 BENEFICIARY_LIMIT). 목록은 생성일/ID 순서.
- 등록 시 존재·ACTIVE·KRW를 확인한다. 등록 호출은 수취인 확인의 30회/60초 제한을 공유한다.
- 별명 변경은 version 필수, alias:null 또는 생략은 별명 삭제. 수취 계좌를 바꾸려면 삭제 후 새로 등록한다.
- 등록은 이체 승인이나 자금 예약이 아니다. 즐겨찾기 선택 후에도 receiver-validation/preview/step-up/실행을 거친다.
- 등록 뒤 대상이 차단되면 이후 이체는 거절된다. 삭제는 이체 취소가 아니다.

## 6. 1회·1일 이체한도

`GET /api/v2/me/transfer-limits` → 200.

```json
{
  "customerId":"33333333-3333-4333-8333-333333333333",
  "perTransfer":"1000000.00","daily":"5000000.00",
  "usedToday":"12000.00","remainingDaily":"4988000.00",
  "date":"2026-10-02","version":0
}
```

- 신규 사용자 기본값은 1회 100만 원/1일 500만 원.
- V8 이전에 존재한 사용자는 기존 정책을 유지하며 perTransfer/daily/remainingDaily가 null(해당 제한 미설정)일 수 있다. null을 0으로 표시하지 않는다.
- 모든 계좌의 성공 송금을 사용자별로 합산한다. 날짜는 Asia/Seoul 기준.
- 입금·반환 입금은 사용액을 감소시키지 않는다. 모의 입금은 사용액을 올리지 않는다.
- 구·신 API가 같은 사용액을 갱신한다. 성공 재시도는 재집계하지 않는다. 실패 이체는 사용액도 롤백한다.
- 기존 원장의 음수 거래를 한국 날짜별로 합산해 이전 데이터의 사용액도 채운다.

감액: TRANSFER_LIMITS 승인 후 `PUT /api/v2/me/transfer-limits` → 200 최신 한도 객체.

```json
{
  "changes":{"version":0,"perTransfer":"500000.00","daily":"1000000.00"},
  "actionToken":"해당 변경값에 대한 승인 토큰"
}
```

금액 문자열은 0 이상, 소수 최대2자리, 정수 최대17자리. perTransfer≤daily. 0은 송금 제한, null 입력은 허용하지 않는다. 최초 미설정에서 제한을 설정할 수 있고, 설정 후에는 증액하거나 미설정 상태로 되돌릴 수 없다(409 LIMIT_INCREASE_NOT_ALLOWED). 이미 사용한 금액 아래로 감액해도 되며 remainingDaily는 0으로 표시한다.

preview에서 참고 검사를 하고 실행 시 사용자 잠금 안에서 다시 검사·누적한다. 한도 감액도 같은 사용자 잠금을 사용한다. 송금이 먼저 완료된 뒤 한도가 감액되면 사용액이 새 한도를 넘을 수 있지만 완료 송금을 소급 취소하지 않는다. 이후 송금을 제한한다.

## 7. 추가 오류

기존 3차 오류 외에 다음을 처리한다.

| HTTP | code | 화면 동작 |
|---|---|---|
| 409 | VERSION_CONFLICT | 최신 설정 조회 후 다시 변경 |
| 409 | DEBIT_DISABLED | 출금 등록 상태 안내 |
| 403 | ACCOUNT_PIN_REQUIRED | PIN 입력 흐름으로 이동; 구 API면 v2 전환 |
| 403 | PIN_INVALID | 재입력 안내 |
| 423 | PIN_LOCKED | GET preferences의 pinLockedUntil 표시 |
| 409 | PER_TRANSFER_LIMIT_EXCEEDED / DAILY_LIMIT_EXCEEDED | 최신 한도·사용액 조회 |
| 409 | LIMIT_INCREASE_NOT_ALLOWED | 증액 불가 안내 |
| 404/409 | BENEFICIARY_NOT_FOUND / BENEFICIARY_EXISTS / BENEFICIARY_LIMIT | 목록·등록 상태 확인 |

## 8. 저장 구조와 범위

V1~V7을 유지하고 V8(구조)·V9(기존 일일 사용액 이전)를 추가한다. V9는 JDBC에서 읽은 거래 시각을 Java Asia/Seoul로 변환해 서버/DB 세션 시간대와 무관하게 날짜를 계산한다. 계좌 표시·출금·PIN 상태, 사용자 한도, 일일 사용액, 설정 승인 토큰, 즐겨찾기 테이블/열을 포함한다. PIN 실패 전용 예외는 지정된 두 검증 진입점에서만 실패 횟수를 커밋하도록 사용한다. 일반 송금 실패는 모두 롤백한다.

실제 PostgreSQL·Windows 사용자 PC·실제 프론트·다중 서버 요청 제한은 최종 통합 때 검증한다. 자동이체 등 향후 송금 경로도 사용자→계좌 잠금 순서와 공통 TransferEngine을 사용해야 한다. 현재 모의 입금 API의 운영 제한은 별도 후속 작업이다.
