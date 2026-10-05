// api.js와 ui.js가 함께 쓰는 오류 code 묶음. ui.js가 api.js(목 모듈 포함)를 불러오지 않게 따로 둔다.

// v6.1부터 키 누락·형식 오류는 IDEMPOTENCY_KEY_INVALID 하나다. INVALID_IDEMPOTENCY_KEY는 v6 예적금이 쓰던 코드로,
// 서버 교체 시점이 어긋나도 같은 분기를 타도록 당분간 함께 둔다(v6.1 답변서 2절).
export const IDEMPOTENCY_ERRORS = new Set(['IDEMPOTENCY_KEY_INVALID', 'INVALID_IDEMPOTENCY_KEY', 'IDEMPOTENCY_KEY_CONFLICT']);
