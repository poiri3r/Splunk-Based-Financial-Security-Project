# 3차 API 계약 — 단계형 이체

2026-10-02. 1·2차 코드에 누적 적용한다. 실제 은행망과 연결되지 않은 프로젝트 내부 계좌 이체다. KB의 인증·실명 확인 기능을 구현하거나 검증한 것이 아니다.

모든 아래 API는 `Authorization: Bearer <로그인 토큰>` 필수다. 시간은 UTC ISO 8601, 금액은 소수 둘째 자리 문자열, 외부 ID는 UUID다. 수수료는 `"0.00"`, 통화는 `KRW`, 은행 코드는 **`LOCAL`만** 지원한다. KB 실제 은행 코드로 요청하지 않는다.

| 용도 | HTTP·경로 | 성공 |
|---|---|---|
| 수취 계좌 확인 | POST /api/v2/transfers/receiver-validation | 200 |
| 확인 화면 정보 생성 | POST /api/v2/transfers/previews | 201 |
| 비밀번호 재확인 | POST /api/v2/auth/step-up | 200 |
| 이체 실행 | POST /api/v2/transfers | 200 (성공 재시도도 동일) |
| 저장된 결과 조회 | GET /api/v2/transfers/{transferId} | 200 |
| 본인 실행 목록 | GET /api/v2/transfers | 200 |

## 1. 수취 계좌 확인

```json
{"bankCode":"LOCAL","accountNumber":"2000000000000001"}
```

응답 예시:

```json
{"bankCode":"LOCAL","maskedAccountNumber":"************0001","receiverName":"김**","nameVerified":false}
```

계좌번호는 숫자 10~20자리, 공백·하이픈은 허용하지 않는다. 계좌번호 검색은 기존 `accounts.number` HMAC 인덱스로 한다. 이름은 프로필에 저장한 자기 신고 이름을 마스킹한 값이며, 이름이 없으면 `이름 미등록`이다. **로그인 아이디는 대신 공개하지 않는다.** 이름 실명 인증과 연락처 검증은 아직 구현하지 않았으므로 nameVerified는 false다.

인증된 사용자별 수취인 확인 30회/60초. 미존재 계좌도 유효한 형식의 요청이면 횟수에 포함된다. 결과는 권한 토큰이 아니며, preview 생성과 실행 때 계좌를 다시 확인한다.

## 2. 확인 화면 생성

```json
{
  "fromAccountId":"11111111-1111-4111-8111-111111111111",
  "bankCode":"LOCAL",
  "toAccountNumber":"2000000000000001",
  "amount":"3000.00",
  "memo":"점심 정산"
}
```

- fromAccountId는 본인 계좌 공개 UUID. 타인/미존재 계좌는 404.
- amount는 **JSON 문자열만** 허용한다. 0.01~99999999999999999.99, 소수 최대 2자리. 지수표기·선행 0·음수·JSON 숫자는 400.
- memo는 선택, 최대 100자. 제어문자는 거절한다. null과 빈 문자열은 구분해 보존한다. 상대방에게 전달되는 입금 메모 기능은 아니다.
- 동일 계좌, 비활성 계좌, KRW 외 계좌, 부족한 잔액, 수취 잔액 상한 초과를 검사한다.
- 생성 횟수는 사용자별 30회/60초. 생성은 자금을 예약하거나 잔액을 변경하지 않는다.

```json
{
  "previewId":"22222222-2222-4222-8222-222222222222",
  "details":{
    "fromAccountId":"11111111-1111-4111-8111-111111111111",
    "fromAccountNumber":"2000000000000002",
    "bankCode":"LOCAL",
    "toAccountNumber":"2000000000000001",
    "receiverName":"김**",
    "nameVerified":false,
    "memo":"점심 정산"
  },
  "amount":"3000.00","fee":"0.00","currency":"KRW",
  "expiresAt":"2026-10-02T10:05:00Z"
}
```

preview는 생성부터 5분 유효한 불변 스냅샷이다. 금액·계좌·메모 변경 시 새 preview를 생성한다. 번호·표시 이름·메모는 JSON 스냅샷으로 묶어 AES-GCM 암호화하며 AAD에 테이블·필드·preview UUID를 포함한다. 회계 계산용 금액은 NUMERIC으로 저장한다.

## 3. 비밀번호 재확인

```json
{"password":"사용자 비밀번호","purpose":"TRANSFER","targetId":"22222222-2222-4222-8222-222222222222"}
```

```json
{"actionToken":"무작위_일회용_토큰","expiresAt":"2026-10-02T10:05:00Z","authenticationMethod":"PASSWORD_RECHECK"}
```

TRANSFER 목적과 해당 본인 preview에만 묶인다. 다른 목적은 현재 미지원(400). 원본 토큰은 응답으로만 전달하고 DB에는 SHA-256 해시만 저장한다. 성공 실행 시 소비한다. 만료 시각은 preview 만료와 같으므로 생성 후 최대 5분이다. BCrypt로 현재 비밀번호를 검증하며 사용자별 **성공·실패 합계 5회/300초**로 제한한다. 미인증 이름/연락처는 이 권한 발급에 사용하지 않는다.

이는 비밀번호 재확인이며 MFA·OTP·인증서 인증이 아니다. 현재 보유한 로그인 토큰과 재확인 권한 둘 다 있어야 실행된다. 로그아웃은 로그인 토큰만 폐기하며 actionToken 자체를 별도로 폐기하지 않는다(남은 로그인 세션에서도 동일 사용자라면 만료 전 사용 가능).

## 4. 실행·멱등성

헤더: `Idempotency-Key: <소문자 표준 UUID>`

```json
{"previewId":"22222222-2222-4222-8222-222222222222","actionToken":"앞 단계 토큰"}
```

```json
{
  "transferId":"33333333-3333-4333-8333-333333333333",
  "status":"completed",
  "previewId":"22222222-2222-4222-8222-222222222222",
  "details":{
    "fromAccountId":"11111111-1111-4111-8111-111111111111",
    "fromAccountNumber":"2000000000000002","bankCode":"LOCAL",
    "toAccountNumber":"2000000000000001","receiverName":"김**",
    "nameVerified":false,"memo":"점심 정산"
  },
  "amount":"3000.00","fee":"0.00","currency":"KRW",
  "balanceAfter":"7000.00","createdAt":"2026-10-02T10:01:00Z"
}
```

실행 본문에 금액·수취 계좌를 다시 보내지 않는다. 서버가 preview의 계좌 연결과 금액을 사용한다. 성공 결과는 본인만 조회할 수 있으며 그 뒤 잔액이 변해도 balanceAfter는 당시 값을 유지한다. 수취인 이름은 확인 당시의 마스킹된 스냅샷이다.

처리 순서:
1. 인증된 사용자 행 잠금 → 해당 사용자·키의 기존 성공 확인.
2. 같은 키·같은 preview·같은 actionToken이면 저장 결과 반환. **preview/token이 만료·소비됐어도** 성공 재시도 가능.
3. 같은 키에 다른 본문 또는 다른 작업(입금·계좌 개설·구 이체 포함)이면 409.
4. 신규 요청은 preview 소유·미사용·만료, actionToken 소유·목적·대상·미사용·만료 검사.
5. 계좌를 내부 ID 오름차순으로 잠근 후 최신 잔액·소유·상태·통화·금액을 재검사.
6. 두 잔액·원장 2건·결과·preview 및 token 소비·성공 키를 하나의 트랜잭션으로 저장.

같은 preview를 다른 키로 실행하면 409 PREVIEW_ALREADY_USED. 실패는 키와 토큰 소비를 남기지 않으며, 유효기간 내 조건이 해결되면 동일 요청 재시도 가능하다. 다른 actionToken을 발급받았다면 본문이 달라지므로 이전 **성공 키**를 재사용하지 않는다.

## 5. 결과·목록

GET /api/v2/transfers/{transferId}는 위 실행 응답과 동일한 저장 결과를 반환한다. 타인 또는 미존재 결과는 모두 404.

GET /api/v2/transfers?from=2026-10-01&to=2026-10-02&size=20&cursor=...:
- from/to는 한국 날짜의 양끝 포함. 기본 to=한국 오늘, from=to의 한 달 전. 최대 1년, 지원 연도 1900~9998.
- size=1~100, 기본20. createdAt 및 내부 ID 내림차순.
- `{items:[결과...],nextCursor:null또는문자열,hasNext:false또는true,from:"...",to:"..."}`.
- cursor는 사용자·날짜·용도에 HMAC으로 묶인다. 동일 조건으로 전달하며 클라이언트가 해석하지 않는다.
- 첫 페이지의 최대 내부 ID를 유지해 나중에 추가된 높은 ID 기록을 제외한다. 완전한 DB MVCC 스냅샷을 보장하지는 않는다.
- **이번 v2 실행으로 만든 본인 송금 결과만 포함한다.** 구 API 송금·수취 내역·모의 입금까지 조회하려면 `/api/v2/accounts/{id}/transactions`를 사용한다. 과거 구 이체의 transferId로 이 결과 API를 호출하면 404.

## 6. 오류

| HTTP | code | 처리 |
|---|---|---|
| 400 | INVALID_INPUT / SAME_ACCOUNT / IDEMPOTENCY_KEY_INVALID | 입력·헤더 수정 |
| 401 | UNAUTHORIZED | 재로그인 |
| 401 | REAUTHENTICATION_FAILED | 재확인 비밀번호 오류; 로그인 만료와 구분 |
| 403 | ACTION_TOKEN_INVALID | 해당 preview로 재확인; preview 만료 시 새 확인 |
| 404 | ACCOUNT_NOT_FOUND / TRANSFER_NOT_FOUND | 소유권 또는 대상 확인 |
| 409 | PREVIEW_EXPIRED | 새 preview 생성 |
| 409 | PREVIEW_ALREADY_USED | 성공 응답의 transferId로 조회; 응답 유실이면 원래 키/본문 재시도 |
| 409 | IDEMPOTENCY_KEY_CONFLICT | 키 재사용 오류; 임의로 새 키로 재송금하지 말고 기존 처리 상태 확인 |
| 409 | INSUFFICIENT_BALANCE / BALANCE_LIMIT_EXCEEDED | 잔액 확인 |
| 409 | ACCOUNT_UNAVAILABLE / CURRENCY_NOT_SUPPORTED | 계좌 상태 확인 |
| 429 | RATE_LIMITED | 해당 제한 기간 후 재시도 |
| 500 | INTERNAL_ERROR | 결과 불명확 시 원래 키/본문으로 재시도 |

## 7. 적용 범위

요청 제한은 단일 서버 메모리 기반으로 재시작 시 초기화된다. 다중 서버 배포 전에 공통 저장소/게이트웨이 제한이 필요하다. 단계형 인증은 v2에 적용하며, 기존 `/api/transfers`는 기존 프론트 호환용으로 로그인 토큰만 사용한다. 프론트 전환 전까지 구 API 제거 또는 동일 인증 강제를 완료한 것으로 간주하지 않는다.

계좌 출금 등록·PIN·1회/1일 한도는 다음 계좌 관리 단계에서 공통 TransferEngine에 연결할 예정이다. 현재는 해당 한도를 적용했다고 표시하지 않는다. 타행·다계좌·자동이체는 아직 미구현이다. 실제 PostgreSQL·실제 프론트 연동 검증은 최종 통합 단계에서 수행한다.
