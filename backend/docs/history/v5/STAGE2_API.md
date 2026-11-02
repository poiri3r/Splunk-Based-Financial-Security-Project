# 사용자·계좌·조회 API — v5 2차 구현 명세

2026-10-02. 이 문서는 실제 구현된 /api/v2 API만 정의한다. 계정 복구·단계형 이체·관리 기능은 후속 작업이다.

## 공통 계약

- JSON 요청/응답. 로그인 이외에는 Authorization: Bearer {token} 필수. v1에서 받은 토큰도 v2에서 사용 가능하다.
- 계좌 경로는 accountId(UUID)다. number는 표시 및 기존 API 연결용 계좌번호 문자열이다.
- v2의 금액은 항상 소수 두 자리 십진 문자열이다. "99999999999999999.99"도 손실 없이 반환한다. 프론트 계산은 십진수 도구를 사용하며 Number로 변환하지 않는다.
- 시각은 UTC ISO 8601, 조회 날짜는 Asia/Seoul 기준이다. 오류 형식은 기존 code/message/선택 field다.
- 기존 /api의 요청·응답 숫자형 금액 및 배열 형식은 유지한다. 신규 API를 v1 주소의 단순 별칭으로 취급하지 않는다.

## API 목록

| 방식 | 주소 | 성공 | 용도 |
|---|---|---:|---|
| POST | /api/v2/auth/login | 200 | 기존 인증 방식으로 로그인 |
| GET | /api/v2/auth/me | 200 | 본인 정보 |
| PUT | /api/v2/me/profile | 200 | 본인 프로필 전체 교체 |
| POST | /api/v2/auth/logout | 204 | 현재 요청 토큰 폐기 |
| POST | /api/v2/accounts | 201 | 기본 입출금계좌 개설·멱등 처리 |
| GET | /api/v2/accounts | 200 | 본인 계좌 목록 |
| GET | /api/v2/accounts/{accountId} | 200 | 본인 계좌 상세 |
| GET | /api/v2/accounts/{accountId}/transactions | 200 | 필터·커서 기반 내역 |

### 로그인

요청: `{"username":"alice","password":"..."}`

응답: `{"token":"<opaque-token>","tokenType":"Bearer","expiresIn":28800}`

공개 API. 필수·JSON 오류 400 INVALID_INPUT, 로그인 불일치 401 UNAUTHORIZED. 기존 회원가입 POST /api/auth/register로 생성한 계정을 사용한다. 이번 단계에는 신규 회원가입·연락처 확인·복구 API가 없다.

### 본인 정보

```json
{"customerId":"<UUID>","username":"alice","name":null,"email":null,"phone":null,"emailVerified":false,"phoneVerified":false,"version":0}
```

name/email/phone은 저장 전 또는 삭제 후 null이다. 고객명은 프로젝트용 입력 정보이며 실명확인 결과가 아니다. 연락처 인증 기능이 없어 verified 값은 항상 false이며, 이 값으로 계정 복구 권한을 부여하지 않는다.

### 프로필 수정

```json
{"currentPassword":"<현재 비밀번호>","version":0,"name":"김영우","email":"Young@EXAMPLE.COM","phone":"010-1234-5678"}
```

- currentPassword, version 필수. GET /auth/me가 반환한 version을 보낸다.
- PUT 전체 교체: name/email/phone 생략 또는 null은 해당 필드를 지운다. 한 항목만 수정할 때도 다른 유지할 값을 함께 보내야 한다.
- name 최대 100자, email 최대 254자·이메일 형식, phone 입력 최대 32자. 빈 문자열·제어문자는 거절한다.
- 이름은 앞뒤 공백 제거. 이메일은 도메인만 소문자화한다. 로컬 부분 대소문자와 점을 임의 변경하지 않는다.
- 국내 전화번호는 공백·하이픈 제거 후 +82 형식으로 변환한다. 국제번호는 +와 8~15자리 숫자 형식이다. 예: 010-1234-5678 → +821012345678.
- 응답은 갱신된 CustomerView. version은 저장 변경 시 증가한다.
- 현재 암호 불일치 401 UNAUTHORIZED, 이미 수정된 version 409 PROFILE_VERSION_CONFLICT, 형식 오류 400 INVALID_INPUT.
- DB에는 이름·연락처 암호문과 연락처 HMAC을 저장한다. 연락처 HMAC에는 이번 단계에서 UNIQUE를 걸지 않는다. 인증된 연락처 정책은 후속 단계에서 정한다.

### 로그아웃

본문 없이 호출한다. 성공은 204, 이후 해당 토큰으로 v1/v2 API를 호출하면 401이다. 다른 기기/로그인의 토큰은 유지한다. 같은 토큰으로 다시 로그아웃하면 401이다. 프론트는 이미 무효인 토큰도 로컬에서 정리한다.

이미 인증 검사를 통과해 실행 중인 다른 요청을 취소하는 기능은 아니다. 전체 세션 폐기·비밀번호 변경은 후속 단계다.

### 계좌 개설

`Idempotency-Key: <소문자 표준 UUID>` 필수. 본문 없이 요청한다. 빈 객체 {}는 허용하고 값이 있는 객체는 400이다.

```json
{"accountId":"<UUID>","number":"2000000000000001","balance":"0.00","openedAt":"2026-10-02T09:00:00Z"}
```

동일 사용자·동일 키 재시도에는 같은 생성 결과를 201로 반환한다. 나중에 입금되어도 이 응답의 balance는 ‘개설 당시 잔액’인 0.00이다. 현재 잔액은 상세 조회로 확인한다. 키 범위는 기존 입금·송금과 공유하므로 다른 업무에 재사용하면 409 IDEMPOTENCY_KEY_CONFLICT다. 키가 없거나 형식이 틀리면 400 IDEMPOTENCY_KEY_INVALID.

### 계좌 목록·상세

목록은 `{"items":[<AccountDetail>, ...]}`이며 없으면 items:[]이다. 목록은 계좌 생성 내부 ID 오름차순이며 이 단계에는 목록 페이지 처리가 없다.

```json
{"accountId":"<UUID>","number":"10010001","accountName":"프로젝트 입출금통장","accountType":"CHECKING","currency":"KRW","status":"ACTIVE","balance":"100000.00","availableBalance":"100000.00","openedAt":"2026-10-02T09:00:00Z"}
```

상세는 위 객체 하나다. 본인 아닌 계좌와 없는 계좌는 모두 404 ACCOUNT_NOT_FOUND, UUID 형식 오류는 400 INVALID_INPUT이다. ACTIVE 계좌의 출금가능금액은 잔액과 같다. 보류금액·출금제한 관리 기능은 아직 없다. 과거 계좌의 실제 개설일을 모르면 openedAt:null이며 프론트에서 ‘정보 없음’으로 표시한다.

### 거래내역

```
GET /api/v2/accounts/{accountId}/transactions?from=2026-10-01&to=2026-10-02&type=ALL&size=20
```

| 파라미터 | 규칙 |
|---|---|
| from | 시작일 포함. 생략하면 적용된 to의 한 달 전 |
| to | 종료일 포함. 생략하면 한국 기준 오늘 |
| type | ALL(기본), DEPOSIT, WITHDRAWAL. 대소문자 구분 |
| size | 기본 20, 1~100 |
| cursor | 이전 응답 nextCursor를 그대로 전달 |

날짜 형식 YYYY-MM-DD. 지원 연도 1900~9998, 시작일 ≤ 종료일, 종료일 ≤ 시작일+1년. 서버에서 시작일 00:00 이상·종료일 다음 날 00:00 미만을 UTC로 변환한다. 잘못된 날짜·범위·유형·size·커서는 400 INVALID_INPUT.

```json
{"items":[{"entryId":"<UUID>","transferId":"<UUID>","counterparty":"10010002","amount":"-3000.00","direction":"WITHDRAWAL","balanceAfter":"97000.00","createdAt":"2026-10-02T09:00:00Z"}],"nextCursor":"<opaque-cursor>","hasNext":true,"from":"2026-10-01","to":"2026-10-02"}
```

- createdAt 내림차순, 같은 시각이면 내부 원장 ID 내림차순. 외부 entryId는 UUID다.
- 입금 amount는 양수, 출금은 음수. source가 시연 입금이면 counterparty는 기존 SIMULATED_CASH_DEPOSIT이다.
- 새 거래부터 balanceAfter를 저장한다. 과거 내역은 null이며 현재 잔액으로 대신 표시하면 안 된다.
- 다음 요청은 응답 from/to를 명시적으로 재사용한다. 날짜·유형·계좌를 변경할 때는 cursor를 지운다.
- 마지막 페이지는 hasNext:false, nextCursor:null. 빈 목록도 동일하다.
- 커서에 HMAC 서명이 있으며 계좌·날짜·유형에 묶여 있다. 다른 계좌/필터로 재사용·변조하면 400이다. 매 요청 소유권 검사를 별도로 수행한다.
- 첫 페이지의 최대 원장 ID보다 큰 새 거래는 이어지는 페이지에 들어오지 않는다. 새로고침은 커서 없이 시작한다. 장기간 DB 트랜잭션 스냅샷을 유지하는 기능은 아니므로 최초 조회 시 미커밋 거래까지 완전히 고정하는 것을 보장하지 않는다.

## 프론트 오류 분기

| 상황 | 처리 |
|---|---|
| 보호 API 401 | 로그인 만료 안내·로컬 토큰 정리·로그인 이동 |
| 프로필 수정의 현재 암호 오류 401 | 해당 화면에서 암호 재입력 안내. 모든 401을 무조건 만료로 단정하지 않음 |
| 계좌 404 | 접근 불가 안내·계좌 목록 복귀 |
| PROFILE_VERSION_CONFLICT | 내 정보 다시 조회 후 사용자에게 수정값 재확인 |
| INVALID_INPUT | field가 있으면 해당 입력 옆에 표시 |
| IDEMPOTENCY_KEY_CONFLICT | 키를 다른 업무/요청에 재사용했는지 확인 |
| 네트워크 오류·일부 5xx의 개설 결과 불명확 | 같은 키로 재시도. 새 키로 다시 개설하지 않음 |

향후 최종 프론트 협의 문서는 전체 기능 구현 뒤 코드와 대조해 작성한다. 본 문서는 이번 단계의 중간 계약이다.
