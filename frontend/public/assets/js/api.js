// 요청 계층: 토큰 첨부, 타임아웃, 오류 파싱, 재시도, 멱등키.
// 네트워크 접근은 transport() 하나로만 한다. 목과 실제 서버는 같은 Response 처리 경로를 탄다.

import {
  API_BASE, USE_MOCK, TIMEOUT_MS, IDEMPOTENT_RETRY_DELAYS_MS, GET_RETRY_DELAYS_MS,
} from './config.js';
import { getToken, clearSession, redirectToLogin } from './session.js';

// 목은 페이지 로드 시 바로 불러온다(개발 패널이 첫 요청 전에 보여야 한다).
const mockModule = USE_MOCK ? import('../../mock/mock.js') : null;

async function transport(request) {
  if (mockModule) return (await mockModule).handle(request);
  return fetch(request);
}

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
};
const MSG_SERVER = '서버에 일시적인 문제가 발생했습니다.';
const MSG_NETWORK = '서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.';
const MSG_TIMEOUT = '서버 응답 시간이 초과되었습니다.';
const MSG_PARSE = '서버 응답을 해석할 수 없습니다.';

export class ApiError extends Error {
  // kind: 'http' | 'network' | 'timeout' | 'parse'
  constructor({ status = 0, code = null, message, field = null, kind }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
    this.kind = kind;
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

function errorFromResponse(status, text) {
  const parsed = tryParseJson(text);
  const body = parsed.ok && parsed.value && typeof parsed.value === 'object' ? parsed.value : null;
  const code = body && typeof body.code === 'string' ? body.code : null;
  return new ApiError({
    status,
    code,
    message: body && typeof body.message === 'string' && body.message ? body.message : defaultMessage(status),
    field: body && typeof body.field === 'string' ? body.field : null,
    kind: 'http',
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
    if (!text) return null; // 201 본문 없음 등
    const parsed = tryParseJson(text);
    if (!parsed.ok) throw new ApiError({ status: response.status, kind: 'parse', message: MSG_PARSE });
    return parsed.value;
  }

  const err = errorFromResponse(response.status, text);
  // 토큰을 붙인 요청의 401만 세션 만료로 본다. 로그인 실패(401)는 여기에 해당하지 않는다.
  if (auth && err.code === 'UNAUTHORIZED') {
    clearSession();
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

// 사용자가 확인한 거래 한 건. 키와 본문은 생성 시점에 고정된다.
// submit()은 불확실한 실패에 같은 키·같은 본문으로 자동 재시도한다.
// - 2xx: 결과 반환, 키 폐기(done = true)
// - 4xx: ApiError를 던지고 키 폐기(done = true)
// - 재시도 소진: err.uncertain = true로 던지고 키 유지. 같은 객체로 submit()을 다시 부르면 같은 키로 보낸다.
// 입력값을 바꾸면 이 객체를 버리고 새로 만들어야 한다.
class IdempotentTx {
  constructor(path, payload) {
    this.path = path;
    this.key = uuidv4();
    this.body = JSON.stringify(payload);
    this.done = false;
  }

  async submit() {
    if (this.done) throw new Error('이미 완료된 거래입니다. 새 거래를 만들어야 합니다.');
    try {
      const result = await request(
        { method: 'POST', path: this.path, body: this.body, auth: true, headers: { 'Idempotency-Key': this.key } },
        IDEMPOTENT_RETRY_DELAYS_MS,
      );
      this.done = true;
      return result;
    } catch (err) {
      if (err instanceof ApiError && isUncertain(err)) {
        err.uncertain = true;
      } else {
        this.done = true;
        if (err.code === 'IDEMPOTENCY_KEY_INVALID' || err.code === 'IDEMPOTENCY_KEY_CONFLICT') {
          console.error(`[api] 멱등키 처리 오류(프론트 버그 의심): ${err.code}`, { key: this.key, body: this.body });
        }
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// API

export const api = {
  // 회원가입·계좌 개설은 멱등하지 않으므로 자동 재시도하지 않는다.
  register: (username, password) =>
    request({ method: 'POST', path: '/api/auth/register', body: JSON.stringify({ username, password }), auth: false }),

  login: (username, password) =>
    request({ method: 'POST', path: '/api/auth/login', body: JSON.stringify({ username, password }), auth: false }),

  openAccount: () => request({ method: 'POST', path: '/api/accounts', auth: true }),

  listAccounts: () => request({ method: 'GET', path: '/api/accounts', auth: true }, GET_RETRY_DELAYS_MS),

  getBalance: (number) =>
    request({ method: 'GET', path: `/api/accounts/${encodeURIComponent(number)}/balance`, auth: true }, GET_RETRY_DELAYS_MS),

  getTransactions: (number) =>
    request({ method: 'GET', path: `/api/accounts/${encodeURIComponent(number)}/transactions`, auth: true }, GET_RETRY_DELAYS_MS),

  health: () => request({ method: 'GET', path: '/health', auth: false }, GET_RETRY_DELAYS_MS),

  // amount는 validate.parseAmount()가 돌려준 값을 그대로 넣는다.
  newDeposit: (accountNumber, amount) => new IdempotentTx('/api/deposits', { accountNumber, amount }),

  newTransfer: (fromAccount, toAccount, amount) =>
    new IdempotentTx('/api/transfers', { fromAccount, toAccount, amount }),
};
