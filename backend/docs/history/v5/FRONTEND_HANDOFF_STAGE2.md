# 프론트 전달 — 2차 API 확장

## 구현 화면별 호출

| 화면 | 호출 순서 | 화면 주의점 |
|---|---|---|
| 로그인 | POST /api/v2/auth/login → GET /api/v2/auth/me → GET /api/v2/accounts | token은 기존과 같은 불투명 Bearer 문자열 |
| 내 정보 | GET /api/v2/auth/me → PUT /api/v2/me/profile | version과 유지할 모든 필드 전달. 연락처는 미인증 표시 |
| 로그아웃 | POST /api/v2/auth/logout → 로컬 인증상태 정리 | 204 본문을 JSON으로 파싱하지 않음 |
| 계좌 개설 | UUID 키 생성 → POST /api/v2/accounts → 목록 갱신 | 불명확한 실패에는 같은 키 유지 |
| 계좌 목록 | GET /api/v2/accounts | 응답 배열 대신 items 사용 |
| 계좌 상세 | GET /api/v2/accounts/{accountId} | number 대신 accountId를 URL에 사용 |
| 거래내역 | GET .../transactions → nextCursor로 다음 페이지 | 조건 변경 시 목록·cursor 초기화, hasNext로 더 보기 제어 |

## 기존 화면에서 바뀌는 계약

1. v1은 유지되어 기존 프론트가 바로 깨지지 않는다. 새 화면부터 v2로 전환한다.
2. v2는 balance/availableBalance/amount/balanceAfter가 문자열이다. 통화 표시용 포맷과 숫자 계산을 분리한다.
3. 계좌목록에서 받은 accountId와 number를 둘 다 보관한다. 현재 이체·시연 입금은 아직 기존 /api이므로 number가 필요하다.
4. openedAt·balanceAfter null을 지원한다. 임의 날짜나 현재 잔액으로 대체하지 않는다.
5. 거래내역 응답 from/to를 다음 페이지에 그대로 전달한다. 한국 자정이 지나 기본 날짜가 바뀌어도 동일 조건을 유지하기 위해 필요하다.
6. 로그아웃 후 같은 토큰은 즉시 다음 요청부터 거절된다. 다른 기기의 로그인은 유지한다.
7. profile PUT은 PATCH가 아니다. 누락 필드는 삭제된다. name/email/phone을 보존하려면 조회값도 같이 전달한다.
8. 이메일·전화번호 저장 성공은 본인확인 성공을 뜻하지 않는다. 아직 복구 기능과 연동하지 않는다.

## 통합 체크리스트

- 계좌 없음·내역 없음 화면, 금액 0 및 큰 금액 문자열 포맷
- 목록 → 상세 → 거래내역 연결, 날짜/유형 변경, 더 보기 마지막 상태
- 상대 계좌 UUID를 넣어도 404, 로그인 없이 보호 API는 401
- 프로필 현재 암호 오류·버전 충돌·유효성 오류 안내
- 개설 버튼 연속 클릭·응답 유실 시 같은 키 재시도
- 로그아웃 후 뒤로 가기·새로고침 시 개인정보 다시 노출하지 않기
- 기존 계좌조회·입금·송금 화면 회귀

실제 프론트 원본·배포 프록시는 아직 검증하지 않았다. 최종 인계 때 기존 API 변경 대조표와 전체 화면 흐름도를 합친다.
