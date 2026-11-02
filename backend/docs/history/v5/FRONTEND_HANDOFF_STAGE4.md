# 프론트 연동 안내 — 4차 중간 계약

전체 개발 완료 후 최종 통합 명세를 제공한다. 이번 문서는 계좌 관리 화면과 3차 이체 화면의 변경 사항이다. 구체적인 JSON/오류는 STAGE4_API.md를 우선한다.

| 화면 | API·흐름 |
|---|---|
| 계좌 관리 목록 | GET /api/v2/accounts?includeHidden=true |
| 별명·숨김·순서 | GET/PATCH /api/v2/accounts/{id}/preferences |
| 출금 등록/해제 | 설정 조회 → step-up(DEBIT_SETTING, accountId, changes) → PUT debit-setting |
| 계좌 PIN 최초 설정 | 설정 조회 → step-up(ACCOUNT_PIN, accountId, changes) → PUT pin |
| 계좌 PIN 변경 | 위 흐름 + 최종 PUT에 currentPin |
| 자주 쓰는 계좌 | GET/POST /api/v2/beneficiaries, PATCH/DELETE /{id} |
| 이체한도 | GET me/transfer-limits → step-up(TRANSFER_LIMITS, customerId, changes) → PUT me/transfer-limits |
| 이체 비밀번호 확인 | step-up(TRANSFER, previewId)에 로그인 password + 계좌 설정 시 pin |

## 설정 변경 공통 규칙

1. GET으로 현재 version과 상태를 읽는다.
2. 사용자가 정한 변경값으로 changes를 만들고 민감한 변경만 step-up을 호출한다.
3. 발급받은 actionToken과 동일한 changes로 최종 PUT을 호출한다.
4. 성공 응답의 version으로 화면 상태를 갱신한다.

대상·값·version을 바꾸면 새 승인이 필요하다. 승인만 발급받고 최종 PUT을 호출하지 않으면 설정은 바뀌지 않는다. PIN 변경은 현재 PIN을 최종 PUT에서 확인한다. 로그인 비밀번호를 확인했다고 기존 PIN 확인을 생략하지 않는다.

- version은 계좌 별명·숨김·순서·출금·PIN 설정에서 공유한다. 다른 탭에서 바꾸면 VERSION_CONFLICT가 날 수 있으니 새로 조회한다.
- 한도 version은 계좌 설정 version과 별개다. targetId는 계좌가 아니라 한도 GET 응답의 customerId.
- step-up의 changes와 최종 PUT의 changes는 중첩 객체다. 설계 초안의 최상위 필드 방식으로 보내지 않는다.
- PIN PUT은 최신 설정 객체를 돌려주는 200이다. 204 응답으로 처리하지 않는다.
- 설정 응답 유실은 GET으로 확인한다. 설정 토큰을 반복 사용해서 성공 응답을 복구하는 기능은 없다.

## 계좌와 PIN 표시

- 계좌 목록·상세에 preferences가 추가됐다. 숨김은 기본 목록에서만 제외하며 관리 화면에서 복원할 수 있다.
- 별명 PATCH에서 생략은 유지, null은 삭제다. 체크박스 hidden은 Boolean, 순서 order는 정수로 보낸다.
- 출금 해제는 실제 이체를 차단한다. 숨김과 혼동하지 않는다. 계좌 최초 출금 상태는 true다.
- PIN 입력은 숫자 4자리 문자열로 다루어 선행 0을 보존한다. 원문·토큰을 URL/로그/분석 이벤트/영구 저장소에 넣지 않는다.
- pinConfigured=false이면 최초 설정 화면, true이면 현재 PIN+새 PIN 변경 화면.
- pinLocked=true이면 pinLockedUntil을 사용자 현지 시각으로 표시한다. 잠금 15분 후 다시 인증할 수 있지만 PIN 분실 재설정 화면은 아직 연결하지 않는다.
- PIN_INVALID는 403, PIN_LOCKED는 423. 로그인 만료로 오해해 로그아웃시키지 않는다.
- 로그인 비밀번호 재확인 실패는 기존 REAUTHENTICATION_FAILED(401). 이것도 토큰 만료와 구별한다.
- 비밀번호·PIN은 해당 요청 후 입력 상태에서 제거한다. actionToken은 필요한 흐름 동안만 메모리에 둔다.

## 3차 이체 화면 변경

계좌 PIN이 설정돼 있으면 로그인 비밀번호와 PIN을 모두 받아 TRANSFER step-up에 전달한다. 이후 실행 요청은 previewId/actionToken으로 동일하다. PIN 변경/잠금/출금 설정 변경 뒤에는 기존 승인 토큰을 재사용하지 않는다.

설정 이후 구 `/api/transfers` 호출은 ACCOUNT_PIN_REQUIRED로 거절될 수 있다. 따라서 PIN 기능을 공개하기 전에 해당 프론트의 이체 화면을 v2로 전환한다. 같은 송금을 두 API에 각각 보내지 않는다.

DEBIT_DISABLED, PER_TRANSFER_LIMIT_EXCEEDED, DAILY_LIMIT_EXCEEDED는 실행 직전에도 발생할 수 있다. preview가 잔액이나 한도를 예약하지 않기 때문이다. 같은 키/본문의 성공 재시도는 기존 3차 계약대로 유지한다.

## 한도·즐겨찾기

- perTransfer/daily=null은 이전 사용자의 제한 미설정이며 0과 다르다. 0은 이체 제한이다.
- usedToday는 사용자 전체 계좌의 한국 날짜 기준 성공 송금액이다. 들어온 돈이 있어도 줄어들지 않는다.
- availableBalance와 실제 송금 가능 금액은 다르다. 잔액과 1회 한도, 남은 일일 한도를 함께 안내한다.
- 감액만 지원한다. ‘한도 증액’ 버튼은 제공하지 않는다.
- 즐겨찾기는 LOCAL 내부계좌 최대100개. 선택하면 계좌번호를 이체 입력에 채우고 수취 확인부터 다시 진행한다.
- 즐겨찾기 중복 POST는409다. 응답 유실 후 재시도에서 중복이면 목록을 조회한다.
- 즐겨찾기 별명 변경·삭제에도 version을 사용한다. DELETE 성공204는 본문을 JSON으로 파싱하지 않는다.

## 다음 연동 범위

회원가입·약관·연락처 검증·아이디 찾기·비밀번호 재설정과 이후 자동이체/상품/출력/공지 기능은 다음 단계다. 현재 프로필의 이름·연락처는 실명 또는 소유 확인 완료 정보가 아니다. 실제 DB 인프라 연동은 마지막에 진행한다.
