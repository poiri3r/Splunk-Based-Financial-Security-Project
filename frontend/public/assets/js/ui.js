// 화면 공통 도우미: 오류 표시, 처리 중 상태, 링크.
// 서버 데이터는 모두 textContent로 넣는다. innerHTML을 쓰지 않는다.

import { ROUTES } from './routes.js';
import { IDEMPOTENCY_ERRORS } from './errors.js';

export const MSG_GENERAL = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
export const MSG_ACCOUNT_NOT_FOUND = '계좌가 없거나 접근할 수 없습니다. 계좌를 다시 확인해 주세요.';

// code별 기본 안내 (작업 요청서 A9·A10). 화면마다 위치·문구가 다르면 showApiError의 overrides로 바꾼다.
const CODE_MESSAGES = {
  ACCOUNT_NOT_FOUND: MSG_ACCOUNT_NOT_FOUND,
  RATE_LIMITED: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  BANKING_SETUP_REQUIRED: '이름과 모의 휴대폰 확인을 먼저 완료해 주세요. (마이페이지 > 내 정보 조회·변경)',
  PIN_LOCKED: '계좌 비밀번호가 잠겼습니다. 시간이 지나도 풀리지 않으니 마이페이지 > 계좌 비밀번호 재설정에서 다시 설정해 주세요.',
  ACCOUNT_PIN_REQUIRED: '계좌 비밀번호가 등록되지 않은 계좌입니다. 조회 > 계좌 관리에서 먼저 등록해 주세요.',
  DEBIT_DISABLED: '출금이 해제된 계좌입니다. 조회 > 계좌 관리에서 출금 등록을 켜 주세요.',
  INSUFFICIENT_BALANCE: '잔액이 부족합니다.',
  PER_TRANSFER_LIMIT_EXCEEDED: '1회 이체한도를 초과합니다. 이체 > 이체한도 조회·변경에서 현재 한도를 확인해 주세요.',
  DAILY_LIMIT_EXCEEDED: '오늘의 이체한도를 초과합니다. 이체 > 이체한도 조회·변경에서 남은 한도를 확인해 주세요.',
  VERSION_CONFLICT: '정보가 그사이 변경되었습니다. 최신 내용을 다시 불러왔으니 확인 후 다시 시도해 주세요.',
  PROFILE_VERSION_CONFLICT: '정보가 그사이 변경되었습니다. 최신 내용을 다시 불러왔으니 확인 후 다시 시도해 주세요.',
  ACCOUNT_UNAVAILABLE: '거래할 수 없는 계좌입니다. 정상(ACTIVE) 입출금 계좌를 선택해 주세요.',
  PRODUCT_ACCOUNT_RESTRICTED: '입출금 계좌에서만 할 수 있는 거래입니다.',
  BALANCE_LIMIT_EXCEEDED: '받는 계좌의 잔액 상한을 초과합니다.',
  CURRENCY_NOT_SUPPORTED: 'KRW 계좌만 지원합니다.',
  FORBIDDEN: '접근 권한이 없습니다.',
};

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
  if (err.code && CODE_MESSAGES[err.code]) {
    showFormError(scope, CODE_MESSAGES[err.code]);
    return;
  }
  if (IDEMPOTENCY_ERRORS.has(err.code)) {
    console.error(`[ui] ${err.code}: 멱등키 처리 오류로 보이는 프론트 버그입니다.`);
    showFormError(scope, MSG_GENERAL);
    return;
  }
  switch (err.code) {
    case 'INVALID_INPUT':
    case 'WEAK_CREDENTIAL':
      showFieldError(scope, err.field, err.message);
      return;
    case 'NOT_FOUND':
      // 경로가 없는 경우. 모든 404를 '상품 없음' 같은 업무 오류로 보지 않는다.
      console.error('[ui] NOT_FOUND: API 경로·프록시·백엔드 프로필을 확인해 주세요.', err.message);
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

// 결과 불명 상태에서 페이지를 떠나면 같은 키로 재시도할 방법이 사라진다. 떠나기 전에 브라우저 경고를 띄운다.
const warnUnload = (event) => { event.preventDefault(); event.returnValue = ''; };
export function guardUnload(on) {
  if (on) window.addEventListener('beforeunload', warnUnload);
  else window.removeEventListener('beforeunload', warnUnload);
}

// 입력칸 여러 개를 한 번에 잠근다(결과 불명 중 수정 방지).
export function setDisabled(nodes, disabled) {
  nodes.forEach((node) => { if (node) node.disabled = disabled; });
}

// 계좌 표시 이름: 별명이 있으면 별명, 없으면 서버 상품명
export const accountLabel = (account) =>
  `${account.preferences?.alias || account.accountName} ${account.number}`;

// 출금 계좌 후보: 정상 입출금 계좌. 화면 편의용 필터이며 최종 허용 여부는 서버가 판단한다.
export const isDebitCandidate = (account) => account.accountType === 'CHECKING' && account.status === 'ACTIVE';

// 링크는 계좌 UUID(accountId)로 통일한다. 계좌번호는 표시와 수취 입력에만 쓴다.
const withQuery = (path, key, value) => `${path}?${key}=${encodeURIComponent(value)}`;
export const transferLink = (accountId) => withQuery(ROUTES.transfer, 'from', accountId);
export const transactionsLink = (accountId) => withQuery(ROUTES.transactions, 'account', accountId);
export const depositLink = (accountId) => withQuery(ROUTES.depositSim, 'account', accountId);
export const manageLink = (accountId) => withQuery(ROUTES.manage, 'account', accountId);
export const pinResetLink = (accountId) => withQuery(ROUTES.pinReset, 'account', accountId);
export const savingsDetailLink = (subscriptionId) => withQuery(ROUTES.savingsDetail, 'id', subscriptionId);
export const transferResultLink = (transferId) => withQuery(ROUTES.transferResult, 'id', transferId);
