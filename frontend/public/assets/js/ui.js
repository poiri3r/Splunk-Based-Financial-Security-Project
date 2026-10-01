// 화면 공통 도우미: 오류 표시, 처리 중 상태, 링크.
// 서버 데이터는 모두 textContent로 넣는다. innerHTML을 쓰지 않는다.

import { ROUTES } from './routes.js';

export const MSG_GENERAL = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
export const MSG_ACCOUNT_NOT_FOUND = '계좌를 찾을 수 없습니다. 계좌번호를 확인해 주세요.';

// scope 안의 [data-error-for="필드명"] 요소에 입력칸 오류를, .form-error 요소에 폼 오류를 표시한다.

export function clearErrors(scope) {
  scope.querySelectorAll('[data-error-for]').forEach((node) => { node.textContent = ''; });
  scope.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
  const formError = scope.querySelector('.form-error');
  if (formError) {
    formError.textContent = '';
    formError.hidden = true;
  }
}

export function showFormError(scope, message) {
  const node = scope.querySelector('.form-error');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
}

// field에 해당하는 입력칸이 없으면 폼 오류로 표시한다.
export function showFieldError(scope, field, message) {
  const node = field ? scope.querySelector(`[data-error-for="${CSS.escape(field)}"]`) : null;
  if (!node) {
    showFormError(scope, message);
    return;
  }
  node.textContent = message;
  const input = scope.querySelector(`[name="${CSS.escape(field)}"]`);
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
}

// ApiError를 code 기준으로 화면에 표시한다. 상태 코드나 message 문자열로 분기하지 않는다.
// overrides: { CODE: { field?, message? } } — 화면별로 특정 code의 위치·문구를 바꾼다.
export function showApiError(scope, err, overrides = {}) {
  if (err.handled) return; // api.js가 이미 처리함(로그인 페이지로 이동 중)
  const override = err.code ? overrides[err.code] : null;
  if (override) {
    showFieldError(scope, override.field, override.message ?? err.message);
    return;
  }
  switch (err.code) {
    case 'INVALID_INPUT':
      showFieldError(scope, err.field, err.message);
      return;
    case 'ACCOUNT_NOT_FOUND':
      showFormError(scope, MSG_ACCOUNT_NOT_FOUND);
      return;
    case 'IDEMPOTENCY_KEY_INVALID':
    case 'IDEMPOTENCY_KEY_CONFLICT':
      console.error(`[ui] ${err.code}: 멱등키 처리 오류로 보이는 프론트 버그입니다.`, err);
      showFormError(scope, MSG_GENERAL);
      return;
    case 'NOT_FOUND':
      console.error('[ui] NOT_FOUND: API 경로 또는 프록시 설정을 확인해 주세요.', err);
      showFormError(scope, MSG_GENERAL);
      return;
    default:
      if (!(err && err.name === 'ApiError')) console.error(err);
      showFormError(scope, err && err.name === 'ApiError' ? err.message : MSG_GENERAL);
  }
}

// 처리 중에는 버튼을 비활성화한다(명세 요구사항).
export function setBusy(button, busy, busyText = '처리 중…') {
  if (busy) {
    button.dataset.idleText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    if (button.dataset.idleText) button.textContent = button.dataset.idleText;
    button.disabled = false;
  }
}

export function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// 계좌번호 쿼리 파라미터 링크 (항상 인코딩한다)
export const transferLink = (number) => `${ROUTES.transfer}?from=${encodeURIComponent(number)}`;
export const transactionsLink = (number) => `${ROUTES.transactions}?account=${encodeURIComponent(number)}`;
export const depositLink = (number) => `${ROUTES.depositSim}?account=${encodeURIComponent(number)}`;
