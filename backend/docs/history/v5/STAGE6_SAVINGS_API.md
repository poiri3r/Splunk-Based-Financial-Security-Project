# 예적금 모의 가입·해지 API — 최종 기능 단계

이 문서는 2026-10-02 확정한 이번 구현 계약이다. 실제 은행 상품·금리·세금 규칙이 아니다. 자동이체는 구현하지 않는다. 적금은 수동 납입만 지원한다.

## 공통 계약

모든 아래 API는 Bearer 로그인 필수. 경로의 id는 subscriptionId(UUID)이며 accountId와 다르다. 금액은 소수 두 자리 문자열로 반환하고 가입 amount도 JSON 문자열만 허용한다. 날짜는 Asia/Seoul, 시각은 UTC. POST 성공은 모두 200이다.

POST는 소문자 표준 UUID인 Idempotency-Key가 필수다. 가입·납입·해지·계좌 개설·일반 이체·모의 입금의 키 공간을 공유한다. 동일 키+동일 본문은 최초 성공 응답을 반환한다. 응답 유실 시 같은 키/본문을 재사용하며, 다른 업무나 바뀐 본문에 키를 재사용하면 409다. 성공 응답은 개인정보 보호를 위해 암호화 저장하고 요청 비교값은 HMAC으로 저장한다. 비밀번호/PIN 원문을 저장하지 않는다. 재시도 성공 응답은 과거 스냅샷이므로 최신 상태는 GET으로 조회한다.

인증은 상품 명령 본문의 password로 수행한다. 별도 /auth/step-up actionToken을 사용하지 않는다. 가입/납입은 출금 계좌 PIN이 있으면 pin도 필수다. 인증 시도는 사용자별 5분 5회 제한이다. PIN 5회 오입력은 15분 잠금. 재설정으로 세션이 폐기되면 재로그인해야 한다. 해지는 본인 입출금 계좌로만 반환하고 로그인 비밀번호를 재확인한다.

## 상품과 계산 정책

| productId | 종류 | 기간 | 연율(소수) | 중도해지 연율 | 최초/월 납입 범위 |
|---|---|---|---|---|---|
| MOCK-DEPOSIT-12 | TERM_DEPOSIT | 12개월 | 0.030000 | 0.010000 | 10000.00~1000000.00 |
| MOCK-SAVINGS-12 | INSTALLMENT_SAVINGS | 12개월 | 0.040000 | 0.010000 | 1000.00~1000000.00 |

- 상품별 조건은 가입 시 계약에 저장한다. termsVersion=MOCK-SAVINGS-2026-v1, 동의 시각도 저장한다. 회원가입 약관 동의와 별도다.
- 예금은 가입 시 일시 납입하고 추가 납입할 수 없다. 적금은 가입 금액을 월 정액으로 정하며 가입 당일 첫 회차를 납입한다.
- 적금 회차는 가입일의 월 기념일부터 다음 기념일 직전까지다. 1월 31일 가입은 2월 말일부터 1회차가 시작하고 3월 31일부터 2회차가 시작한다. 각 회차 1번, 총 최대 12번. 누락분 소급 납입/금액 변경/만기 이후 납입은 없다.
- 가입·납입은 출금 등록된 ACTIVE/KRW 본인 CHECKING 계좌만 사용한다. 1회·일일 이체 한도와 사용액을 공유한다. 가입 화면에는 상품 상한뿐 아니라 현재 이체 가능액도 안내한다.
- 해지는 ACTIVE/KRW 본인 CHECKING으로만 반환한다. 본인 원금 반환이므로 출금 등록·PIN·이체 한도와 별개다. 대상 잔액 상한은 검사한다.
- 이자는 각 납입금 × 적용 연율 × 보유 실제 일수 / 365를 합한 뒤 소수 둘째 자리 아래 버림. 가입일~해지일 또는 만기일까지의 날짜 차이를 쓴다. 윤년도 분모 365. 중도 해지는 전체 납입금에 중도 연율을 적용한다. 누락 적금 회차에 대한 별도 벌점은 없다.
- 세금 0.00, 수수료 0, 만기 이후 추가 이자 없음. 자동 만기 해지/재예치 없음. 이자는 SIMULATED_SAVINGS_INTEREST 출처의 모의 입금으로 원장에 별도 기록한다.
- 예적금 계좌는 일반 이체의 입금/출금 및 /api/deposits 대상이 아니다. 출금 등록/PIN 설정·재설정도 거절한다. 별명·숨김·순서 변경은 가능하다.

## 경로

| 방식 | /api/v2 아래 경로 | 결과 |
|---|---|---|
| GET | /savings-products | 상품 배열(상품명/기간/금리/범위/termsVersion/termsText) |
| POST | /savings | 가입 + 첫 납입, 계약 상세 |
| GET | /savings | {"items":[계약 상세]} |
| GET | /savings/{id} | 계약 상세 |
| POST | /savings/{id}/payments | 현재 회차 정액 납입, 갱신 상세 |
| GET | /savings/{id}/closure-quote?targetAccountId={UUID} | 해지 예상액 및 quoteToken |
| POST | /savings/{id}/closure | 해지 결과 |

### 가입 요청

```json
{"productId":"MOCK-SAVINGS-12","sourceAccountId":"<본인 입출금 accountId>","amount":"1000.00","termsVersion":"MOCK-SAVINGS-2026-v1","password":"<현재 로그인 비밀번호>","pin":"1234"}
```

PIN이 없는 입출금 계좌면 pin 생략. 상품 조회 → 조건·동의 표시 → 출금 계좌/금액 선택 → 비밀번호/PIN 확인 → POST 순서다. 새로운 예적금 전용 계좌가 만들어지고 출금 계좌와 함께 원장에 기록된다.

### 계약 상세 응답 예

```json
{"subscriptionId":"<UUID>","productId":"MOCK-SAVINGS-12","accountId":"<예적금 accountId>","accountNumber":"3000000000000001","status":"ACTIVE","principal":"1000.00","installment":"1000.00","openedOn":"2026-10-02","maturityOn":"2027-10-02","closedOn":null,"version":0,"annualRate":"0.040000","earlyRate":"0.010000","termsVersion":"MOCK-SAVINGS-2026-v1","simulation":true,"payments":[{"period":0,"paidOn":"2026-10-02","amount":"1000.00"}]}
```

principal은 현재 예적금 계좌 잔액이다. 해지 뒤에는 0.00이며 납입 이력은 남는다. 전체 납입 원금은 payments 합계다. accountId는 전체 계좌 조회/거래내역에서 사용하고 subscriptionId는 상품 업무에서 사용한다. 일반 계좌 조회에도 예적금 계좌가 보이며 availableBalance=0.00, debitEnabled=false다.

### 수동 납입

```json
{"sourceAccountId":"<본인 입출금 accountId>","version":0,"password":"<현재 로그인 비밀번호>","pin":"1234"}
```

금액은 요청하지 않는다. 계약 installment만큼 납입하며 sourceAccountId는 매번 본인 CHECKING 중에서 선택한다. 성공하면 version 증가. 같은 회차에 다른 키로 재요청해도 추가 납입하지 않는다.

### 해지 예상액

```json
{"subscriptionId":"<UUID>","targetAccountId":"<본인 입출금 accountId>","version":0,"quoteDate":"2026-10-02","principal":"1000.00","interest":"0.00","tax":"0.00","total":"1000.00","closureType":"EARLY","simulation":true,"quoteToken":"<HMAC>"}
```

closureType=EARLY 또는 MATURE. quoteToken은 사용자·계약·버전·반환 계좌·날짜·금액에 결합한다. 조회일 당일만 유효하다. 납입으로 version이 바뀌거나 날짜/반환 계좌가 바뀌면 다시 견적을 조회한다. 예상액을 프론트에서 임의 계산하여 확정하지 않는다.

### 해지 요청

```json
{"targetAccountId":"<견적과 같은 accountId>","version":0,"quoteDate":"2026-10-02","quoteToken":"<견적에서 받은 HMAC>","password":"<현재 로그인 비밀번호>"}
```

성공 응답은 예상액 응답에서 quoteToken을 제거하고 status=CLOSED, 증가한 version을 포함한다. 원금 반환+모의 이자+양쪽 원장+해지 상태+중복 방지 기록은 한 트랜잭션이다. 해지 계좌는 삭제하지 않고 CLOSED로 보존한다. 해지 성공 후 계좌/상품/원장을 다시 조회한다.

## 주요 오류

| HTTP | code | 화면 처리 |
|---|---|---|
| 400 | INVALID_INPUT / INVALID_IDEMPOTENCY_KEY | 입력/키 확인 |
| 400 | PRODUCT_NOT_FOUND | 상품 재조회 |
| 401 | REAUTHENTICATION_FAILED | 비밀번호 재입력 |
| 401 | UNAUTHORIZED | 재로그인 |
| 403 | ACCOUNT_PIN_REQUIRED / PIN_INVALID | PIN 입력/수정 |
| 404 | SAVINGS_NOT_FOUND / ACCOUNT_NOT_FOUND | 접근 불가 또는 조회 대상 없음 |
| 409 | TERMS_VERSION_MISMATCH | 조건 재조회·재동의 |
| 409 | PRODUCT_AMOUNT_INVALID | 상품 최소/최대 금액 확인 |
| 409 | INSUFFICIENT_BALANCE / PER_TRANSFER_LIMIT_EXCEEDED / DAILY_LIMIT_EXCEEDED | 잔액·한도 재조회 |
| 409 | PERIOD_ALREADY_PAID / PAYMENT_PERIOD_CLOSED / PAYMENT_NOT_SUPPORTED | 납입 이력·상품 상태 표시 |
| 409 | VERSION_CONFLICT / QUOTE_STALE | 상세·견적 재조회 |
| 409 | SAVINGS_CLOSED | 해지 완료 안내 |
| 409 | PRODUCT_ACCOUNT_RESTRICTED | 상품 전용 화면 사용 |
| 409 | ACCOUNT_UNAVAILABLE / BALANCE_LIMIT_EXCEEDED / DEBIT_DISABLED | 계좌 상태 확인 |
| 409 | IDEMPOTENCY_KEY_CONFLICT | 다른 요청에 키 재사용하지 않기 |
| 423 | PIN_LOCKED | 잠금/복구 안내 |
| 429 | RATE_LIMITED | 잠시 후 재시도 안내 |

네트워크/500 오류는 성공 여부가 불명확하므로 같은 키/본문으로 재시도한다. 새로운 키로 중복 가입하지 않는다. 비밀번호/PIN을 URL, 로그, 분석 이벤트, 영구 브라우저 저장소에 넣지 않는다.
