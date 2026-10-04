// 요청 계층: 토큰 첨부, 타임아웃, 오류 파싱, 재시도, 멱등키.
// 네트워크 접근은 transport() 하나로만 한다. 목과 실제 서버는 같은 Response 처리 경로를 탄다.
// 업무 API는 백엔드 v6 계약(/api/v2)을 따른다. 경로·본문은 bank-backend-v6 문서의 작업 요청서 A1과 Controller 기준이다.

import {
  API_BASE, USE_MOCK, TIMEOUT_MS, IDEMPOTENT_RETRY_DELAYS_MS, GET_RETRY_DELAYS_MS,
} from './config.js';
import { getToken, clearSession, redirectToLogin, setNotice } from './session.js';
import { IDEMPOTENCY_ERRORS } from './errors.js';

// 목은 페이지 로드 시 바로 불러온다(개발 패널이 첫 요청 전에 보여야 한다).
const mockModule = USE_MOCK ? import('../../mock/mock.js') : null;

async function transport(request) {
  if (mockModule) return (await mockModule).handle(request);
  return fetch(request);
}

const V2 = '/api/v2';
const SESSION_PATH = `${V2}/auth/session`;

// ---------------------------------------------------------------------------
// 오류

const DEFAULT_MESSAGES = {
  400: '요청 형식이 올바르지 않습니다.',
  401: '인증이 필요합니다. 다시 로그인해 주세요.',
  403: '접근 권한이 없습니다.',
  404: '요청한 경로를 찾을 수 없습니다.',
  405: '허용되지 않은 요청 방식입니다.',
  409: '요청이 현재 상태와 충돌합니다.',
  415: '지원하지 않는 요청 형식입니다.',
  423: '잠긴 상태라 처리할 수 없습니다.',
  429: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
};
const MSG_SERVER = '서버에 일시적인 문제가 발생했습니다.';
const MSG_NETWORK = '서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.';
const MSG_TIMEOUT = '서버 응답 시간이 초과되었습니다.';
const MSG_PARSE = '서버 응답을 해석할 수 없습니다.';
// v6.1 답변서 6절: 토큰을 붙인 요청의 UNAUTHORIZED 뒤 로그인 화면에 보여 줄 안내
const MSG_RELOGIN = '로그인이 만료되었거나 보안 설정이 변경되었습니다. 다시 로그인해 주세요.';

export class ApiError extends Error {
  // kind: 'http' | 'network' | 'timeout' | 'parse'
  // retryAfter: 429의 Retry-After(초). 지금은 step-up만 보낸다. 헤더가 없거나 해석할 수 없으면 null.
  constructor({ status = 0, code = null, message, field = null, kind, retryAfter = null }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
    this.kind = kind;
    this.retryAfter = retryAfter;
    this.handled = false; // true면 api.js가 이미 처리했다(예: 로그인 페이지로 이동). 화면에 표시하지 않는다.
  }
}

function defaultMessage(status) {
  if (status >= 500) return MSG_SERVER;
  return DEFAULT_MESSAGES[status] || `요청을 처리하지 못했습니다. (HTTP ${status})`;
}

function tryParseJson(text) {
  if (!text) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

// Retry-After는 양의 정수 초만 받는다(백엔드는 올림한 정수 초를 보낸다). HTTP 날짜 형식은 쓰지 않으므로 무시한다.
function parseRetryAfter(value) {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const seconds = Number(value.trim());
  return seconds > 0 ? seconds : null;
}

function errorFromResponse(status, text, headers) {
  const parsed = tryParseJson(text);
  const body = parsed.ok && parsed.value && typeof parsed.value === 'object' ? parsed.value : null;
  const code = body && typeof body.code === 'string' ? body.code : null;
  return new ApiError({
    status,
    code,
    message: body && typeof body.message === 'string' && body.message ? body.message : defaultMessage(status),
    field: body && typeof body.field === 'string' ? body.field : null,
    kind: 'http',
    retryAfter: status === 429 ? parseRetryAfter(headers.get('Retry-After')) : null,
  });
}

// 결과가 불확실해 같은 키로 다시 보내야 하는 실패인가.
export function isUncertain(err) {
  if (!(err instanceof ApiError)) return false;
  return err.kind === 'network' || err.kind === 'timeout' || err.kind === 'parse' || err.status >= 500;
}

// ---------------------------------------------------------------------------
// 요청 1회

async function attemptOnce({ method, path, body, auth, headers: extraHeaders }) {
  const headers = { Accept: 'application/json', ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (!token) {
      // 요청 전에 만료를 알았다. 서버에 보내지 않고 로그인으로 보낸다.
      const err = new ApiError({ status: 401, code: 'UNAUTHORIZED', message: DEFAULT_MESSAGES[401], kind: 'http' });
      err.handled = true;
      redirectToLogin();
      throw err;
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);

  let response;
  let text;
  try {
    const request = new Request(API_BASE + path, { method, headers, body, signal: controller.signal });
    response = await transport(request);
    text = await response.text();
  } catch {
    // fetch는 네트워크 오류에 TypeError, abort에 AbortError를 던진다.
    throw new ApiError({
      kind: timedOut ? 'timeout' : 'network',
      message: timedOut ? MSG_TIMEOUT : MSG_NETWORK,
    });
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) {
    // 세션 상태 조회를 뺀 인증 요청은 서버가 활동으로 기록해 유휴 만료를 늦춘다. layout.js가 남은 시간을 다시 읽는다.
    if (auth && !(method === 'GET' && path === SESSION_PATH)) window.dispatchEvent(new CustomEvent('pb-activity'));
    if (!text) return null; // 204 등 본문 없음
    const parsed = tryParseJson(text);
    if (!parsed.ok) throw new ApiError({ status: response.status, kind: 'parse', message: MSG_PARSE });
    return parsed.value;
  }

  const err = errorFromResponse(response.status, text, response.headers);
  // 토큰을 붙인 요청의 UNAUTHORIZED만 세션 만료로 본다.
  // 같은 401이라도 REAUTHENTICATION_FAILED(현재 비밀번호 불일치)·LOGIN_FAILED는 로그아웃하지 않는다(작업 요청서 A2).
  if (auth && err.code === 'UNAUTHORIZED') {
    clearSession();
    setNotice(MSG_RELOGIN);
    err.handled = true;
    redirectToLogin();
  }
  throw err;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// retryDelays: 불확실한 실패 뒤 재시도 간격 목록. 빈 배열이면 재시도하지 않는다.
async function request(options, retryDelays = []) {
  for (let i = 0; ; i++) {
    try {
      return await attemptOnce(options);
    } catch (err) {
      if (!(err instanceof ApiError) || err.handled || !isUncertain(err) || i >= retryDelays.length) throw err;
      console.warn(`[api] ${options.method} ${options.path} 재시도 ${i + 1}/${retryDelays.length} (${err.kind} ${err.status})`);
      await sleep(retryDelays[i]);
    }
  }
}

const get = (path, auth = true) => request({ method: 'GET', path, auth }, GET_RETRY_DELAYS_MS);
// 상태를 바꾸는 요청. 자동 재시도하지 않는다(복구 코드·확인 권한처럼 한 번 쓰면 소비되는 값이 들어갈 수 있다).
const send = (method, path, payload, auth = true) =>
  request({ method, path, body: payload === undefined ? undefined : JSON.stringify(payload), auth });

// 값이 있는 항목만 쿼리 문자열로 만든다.
function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const id = (value) => encodeURIComponent(value);

// ---------------------------------------------------------------------------
// 멱등키

// crypto.randomUUID()는 보안 컨텍스트(HTTPS·localhost)에서만 존재하므로 쓰지 않는다.
export function uuidv4() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// 사용자가 확인한 작업 한 건. 키와 본문은 생성 시점에 고정된다.
// submit()은 불확실한 실패에 같은 키·같은 본문으로 자동 재시도한다.
// - 2xx: 결과 반환, 키 폐기(done = true)
// - 4xx: ApiError를 던지고 키 폐기(done = true)
// - 재시도 소진: err.uncertain = true로 던지고 키 유지(pending = true). 같은 객체로 submit()을 다시 부르면 같은 키로 보낸다.
// 입력값을 바꾸면 이 객체를 버리고 새로 만들어야 한다. 결과 불명(pending) 중에는 화면이 입력 수정을 막는다.
// 본문에는 비밀번호·PIN·승인 토큰이 들어갈 수 있으므로 메모리에만 두고 로그·브라우저 저장소에 남기지 않는다.
class IdempotentTx {
  constructor(path, payload, { auth = true } = {}) {
    this.path = path;
    this.auth = auth;
    this.key = uuidv4();
    this.body = JSON.stringify(payload);
    this.done = false;
    this.pending = false;
  }

  async submit() {
    if (this.done) throw new Error('이미 완료된 거래입니다. 새 거래를 만들어야 합니다.');
    try {
      const result = await request(
        { method: 'POST', path: this.path, body: this.body, auth: this.auth, headers: { 'Idempotency-Key': this.key } },
        IDEMPOTENT_RETRY_DELAYS_MS,
      );
      this.done = true;
      this.pending = false;
      return result;
    } catch (err) {
      if (err instanceof ApiError && isUncertain(err)) {
        err.uncertain = true;
        this.pending = true;
      } else {
        this.done = true;
        this.pending = false;
        if (IDEMPOTENCY_ERRORS.has(err.code)) {
          // 본문은 남기지 않는다(비밀번호·PIN·승인 토큰 포함 가능).
          console.error(`[api] 멱등키 처리 오류(프론트 버그 의심): ${err.code} ${this.path}`);
        }
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// API (공개 API는 auth=false: 약관, 가입, 로그인, REGISTER 연락처 확인, 계정 복구, 예적금 상품 목록)

export const api = {
  health: () => get('/health', false),

  // ---- 약관·가입·연락처 확인 (R1) ----
  terms: () => get(`${V2}/terms`, false),

  // purpose: REGISTER(공개) | PROFILE(로그인 필요). 응답 202 { challengeId, expiresAt, delivery, inboxToken }
  startChallenge: (purpose, contact) =>
    send('POST', `${V2}/contact-challenges`, { purpose, channel: 'SMS', contact }, purpose === 'PROFILE'),

  verifyChallenge: (purpose, challengeId, code) =>
    send('POST', `${V2}/contact-challenges/${id(challengeId)}/verify`, { code }, purpose === 'PROFILE'),

  // 201 { customerId }. 같은 키·본문 재전송은 같은 결과를 돌려준다.
  newRegistration: ({ username, password, name, termsVersions, contactGrant }) =>
    new IdempotentTx(`${V2}/auth/register`, { username, password, name, termsVersions, contactGrant }, { auth: false }),

  // ---- 로그인·세션 (A2) ----
  login: (username, password) => send('POST', `${V2}/auth/login`, { username, password }, false),
  logout: () => send('POST', `${V2}/auth/logout`),
  // 상태 조회는 유휴 시간을 늘리지 않는다. 남은 시간 표시에는 이것만 쓴다(계좌 조회 폴링 금지).
  sessionStatus: () => get(SESSION_PATH),
  extendSession: () => send('POST', `${V2}/auth/session/extend`),

  // ---- 계정 복구 (R2·R3·A7) ----
  // proof: { purpose, method:'ACCOUNT', name, accountNumber, pin } | { purpose, method:'RECOVERY_CODE', recoveryCode }
  verifyRecovery: (proof) => send('POST', `${V2}/recovery/verifications`, proof, false),
  resetPassword: (resetToken, newPassword) => send('POST', `${V2}/recovery/password`, { resetToken, newPassword }, false),
  unlockLogin: (resetToken) => send('POST', `${V2}/recovery/login-unlock`, { resetToken }, false),

  // ---- 내 정보 (R6·A7) ----
  getMe: () => get(`${V2}/auth/me`),
  // PUT은 선택 항목을 통째로 바꾼다. 생략·null인 이메일은 지워지므로 유지할 값을 함께 보낸다.
  updateProfile: ({ currentPassword, version, name, email, phone }) =>
    send('PUT', `${V2}/me/profile`, { currentPassword, version, name, email, phone }),
  applyContact: (currentPassword, contactGrant) => send('PUT', `${V2}/me/contact`, { currentPassword, contactGrant }),
  changePassword: (currentPassword, newPassword) => send('PUT', `${V2}/me/password`, { currentPassword, newPassword }),
  myTerms: () => get(`${V2}/me/terms`),
  recoveryCodeStatus: () => get(`${V2}/me/recovery-codes`),
  issueRecoveryCodes: (currentPassword) => send('POST', `${V2}/me/recovery-codes`, { currentPassword }),

  // ---- 계좌 (R4·A4) ----
  listAccounts: ({ includeHidden = false } = {}) => get(`${V2}/accounts${query({ includeHidden: includeHidden || undefined })}`),
  getAccount: (accountId) => get(`${V2}/accounts/${id(accountId)}`),
  // 201 { accountId, number, balance, openedAt }
  newOpenAccount: ({ pin, termsVersion }) => new IdempotentTx(`${V2}/accounts`, { pin, termsVersion }),
  // { from, to, type, size, cursor } → { items, nextCursor, hasNext, from, to }
  getTransactions: (accountId, params = {}) => get(`${V2}/accounts/${id(accountId)}/transactions${query(params)}`),

  // ---- 계좌 설정·한도·자주 쓰는 계좌 (A5) ----
  getPreferences: (accountId) => get(`${V2}/accounts/${id(accountId)}/preferences`),
  // { version, alias?, hidden?, order? }. 보내지 않은 항목은 바뀌지 않는다.
  updatePreferences: (accountId, changes) => send('PATCH', `${V2}/accounts/${id(accountId)}/preferences`, changes),
  // 설정 승인: purpose ACCOUNT_PIN | DEBIT_SETTING | TRANSFER_LIMITS, 이체 승인: purpose TRANSFER (+pin)
  stepUp: (payload) => send('POST', `${V2}/auth/step-up`, payload),
  setDebit: (accountId, changes, actionToken) =>
    send('PUT', `${V2}/accounts/${id(accountId)}/debit-setting`, { changes, actionToken }),
  changePin: (accountId, changes, actionToken, currentPin) =>
    send('PUT', `${V2}/accounts/${id(accountId)}/pin`, { changes, actionToken, currentPin }),
  // { currentPassword, newPin, contactGrant } 또는 { currentPassword, newPin, recoveryCode } → 204, 이후 재로그인
  resetPin: (accountId, payload) => send('POST', `${V2}/accounts/${id(accountId)}/pin/reset`, payload),
  getLimits: () => get(`${V2}/me/transfer-limits`),
  updateLimits: (changes, actionToken) => send('PUT', `${V2}/me/transfer-limits`, { changes, actionToken }),
  listBeneficiaries: () => get(`${V2}/beneficiaries`),
  addBeneficiary: (accountNumber, alias) =>
    send('POST', `${V2}/beneficiaries`, { bankCode: 'LOCAL', accountNumber, alias }),
  updateBeneficiary: (beneficiaryId, version, alias) =>
    send('PATCH', `${V2}/beneficiaries/${id(beneficiaryId)}`, { version, alias }),
  deleteBeneficiary: (beneficiaryId, version) =>
    send('DELETE', `${V2}/beneficiaries/${id(beneficiaryId)}${query({ version })}`),

  // ---- 이체 (A3): 수취 확인 → preview → step-up → 멱등 실행 ----
  validateReceiver: (accountNumber) =>
    send('POST', `${V2}/transfers/receiver-validation`, { bankCode: 'LOCAL', accountNumber }),
  createPreview: ({ fromAccountId, toAccountNumber, amount, memo }) =>
    send('POST', `${V2}/transfers/previews`, { fromAccountId, bankCode: 'LOCAL', toAccountNumber, amount, memo }),
  newTransferExecution: (previewId, actionToken) => new IdempotentTx(`${V2}/transfers`, { previewId, actionToken }),
  getTransfer: (transferId) => get(`${V2}/transfers/${id(transferId)}`),
  listTransfers: (params = {}) => get(`${V2}/transfers${query(params)}`),

  // ---- 시연용 가상 입금 (demo 프로필 전용) ----
  newDemoDeposit: (accountNumber, amount) => new IdempotentTx(`${V2}/demo/deposits`, { accountNumber, amount }),

  // ---- 예금·적금 (R5·A6) ----
  savingsProducts: () => get(`${V2}/savings-products`, false),
  // 가입·납입은 출금 계좌 PIN만 보낸다(2026-10-04 합의, 로그인 비밀번호 제외). 해지는 계속 로그인 비밀번호.
  newSavingsJoin: ({ productId, sourceAccountId, amount, termsVersion, pin }) =>
    new IdempotentTx(`${V2}/savings`, { productId, sourceAccountId, amount, termsVersion, pin }),
  listSavings: () => get(`${V2}/savings`),
  getSavings: (subscriptionId) => get(`${V2}/savings/${id(subscriptionId)}`),
  newSavingsPayment: (subscriptionId, { sourceAccountId, version, pin }) =>
    new IdempotentTx(`${V2}/savings/${id(subscriptionId)}/payments`, { sourceAccountId, version, pin }),
  closureQuote: (subscriptionId, targetAccountId) =>
    get(`${V2}/savings/${id(subscriptionId)}/closure-quote${query({ targetAccountId })}`),
  newSavingsClosure: (subscriptionId, { targetAccountId, version, quoteDate, quoteToken, password }) =>
    new IdempotentTx(`${V2}/savings/${id(subscriptionId)}/closure`, { targetAccountId, version, quoteDate, quoteToken, password }),
};
