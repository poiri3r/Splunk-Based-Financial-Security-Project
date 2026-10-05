# 프론트 연동 안내 — 3차 중간 계약

2차 문서의 사용자·계좌·조회 계약은 유지한다. 새 이체 화면은 STAGE3_API.md를 기준으로 연결한다. 아래 흐름은 자체 은행 프로젝트이며 KB 실명 확인/OTP 완료 화면으로 표시하지 않는다.

## 화면과 상태

| 화면·행동 | 호출 | 화면에서 보관할 값 |
|---|---|---|
| 출금 계좌 선택 | GET /api/v2/accounts | 본인 accountId |
| 수취 계좌 확인 | POST /api/v2/transfers/receiver-validation | 마스킹 이름·번호, nameVerified=false |
| 금액·메모 입력 후 확인 | POST /api/v2/transfers/previews | previewId, 서버 details/amount/fee/expiresAt |
| 비밀번호 재확인 | POST /api/v2/auth/step-up | actionToken, expiresAt |
| 최종 실행 | POST /api/v2/transfers + Idempotency-Key | 동일 요청의 키·본문; 성공 transferId |
| 완료·다시 보기 | GET /api/v2/transfers/{transferId} | 저장 결과 |
| 내가 실행한 새 이체 목록 | GET /api/v2/transfers | items/nextCursor/hasNext |
| 입금·출금 통합 내역 | GET /api/v2/accounts/{id}/transactions | 기존 2차 계약 |

- 은행 선택지는 `LOCAL` 하나, 화면 이름은 ‘프로젝트 은행(모의)’로 한다. 타행 선택지는 이번 연결에서 제공하지 않는다.
- 표시 이름은 실명 미검증이다. ‘실명 인증 완료’라고 쓰지 않는다. 이름 미등록이면 서버 문구 그대로 표시한다.
- 금액은 문자열로 보내고 Number/parseFloat로 변환해 합산하지 않는다. 소수 2자리 계약을 유지한다.
- 수취 계좌·금액·메모·출금 계좌 중 하나라도 바꾸면 preview와 actionToken을 폐기하고 새 확인 흐름으로 이동한다.
- 확인 화면의 표시값은 서버 응답을 사용한다. preview는 자금을 예약하지 않는다.
- 비밀번호는 재확인 요청 후 화면 상태에서 제거한다. actionToken을 URL·로그·분석 이벤트·영구 로컬 저장소에 넣지 않는다.
- 비밀번호 재확인 실패 401 REAUTHENTICATION_FAILED는 로그인 토큰 만료와 구분한다. 모든 401에서 무조건 로그아웃하지 않는다.
- 실행 버튼 중복 클릭 방지와 서버 멱등 처리를 함께 사용한다. 새 클릭마다 키를 생성하지 않는다.
- 네트워크 타임아웃/500이면 **같은 키·같은 본문**으로 재시도한다. 이미 성공했다면 만료 뒤에도 기존 결과를 받는다.
- 결과를 알 수 없는데 새 preview/새 키로 바로 재송금하지 않는다. 보관한 요청으로 재조회하고, 필요하면 본인 이체 목록·원장을 확인한다.
- 브라우저 재시작 등으로 원래 요청 정보가 사라졌다면 이체 목록/원장부터 확인한다. 새 요청 실행을 자동화하지 않는다.
- 실행 성공 후 목록·잔액을 다시 조회한다. 응답 balanceAfter는 당시 잔액으로 최신 잔액과 구별한다.
- 목록은 날짜 필터를 유지하며 nextCursor를 그대로 전달한다. 필터 변경 시 cursor를 초기화한다.

## 기존 API와 신규 API의 관계

| 기존 | 새 화면 | 백엔드 처리 |
|---|---|---|
| POST /api/transfers (번호·금액) | preview → step-up → POST /api/v2/transfers | **공통 TransferEngine**으로 계좌 잠금·상태 검사·두 잔액·원장 처리 |
| 성공 transferId만 표시 | GET /api/v2/transfers/{id} | 신규 v2 실행의 저장 스냅샷만 지원 |
| GET /api/accounts/{number}/transactions | GET /api/v2/accounts/{accountId}/transactions | 모든 경로의 원장을 조회 |

동일 송금을 구·신 API 양쪽으로 호출하지 않는다. 두 경로는 같은 사용자·키 저장소를 공유하지만 요청 계약과 작업명이 달라 키를 교차 사용하면 409다. 구 API 응답/입력은 유지하고 계좌 상태·통화 검사를 공통화했다. 구 API는 step-up을 요구하지 않으므로 v2 화면 전환 후 폐기 또는 접근 제한을 협의해야 한다.

## 후속 협의·미구현

- 실명 미검증/이름 미등록 표시 문구와 기본 내부은행 이름.
- 단계형 이체 화면 전환 일정과 기존 이체 API 제거 시점.
- 계좌 별명·숨김·출금 등록·PIN·1회/1일 한도는 다음 단계. 현재 한도 UI를 구현 완료로 표시하지 않는다.
- 다중 서버 요청 제한, 실제 PostgreSQL 및 실제 프론트 연결 테스트는 최종 통합 단계.
- 공과금·외환·펀드·대출은 이번 개발 범위에서 제외.

전체 개발 완료 후 API 전체 목록·화면 흐름·변경 매핑·협의사항·연동 체크리스트를 통합한 최종 문서를 별도로 제공한다.
