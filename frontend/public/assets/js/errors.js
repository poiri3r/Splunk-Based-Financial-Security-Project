// api.js와 ui.js가 함께 쓰는 오류 code 묶음. ui.js가 api.js(목 모듈 포함)를 불러오지 않게 따로 둔다.

// 백엔드는 같은 의미의 코드를 두 가지로 쓴다(예적금만 INVALID_IDEMPOTENCY_KEY).
export const IDEMPOTENCY_ERRORS = new Set(['IDEMPOTENCY_KEY_INVALID', 'INVALID_IDEMPOTENCY_KEY', 'IDEMPOTENCY_KEY_CONFLICT']);
