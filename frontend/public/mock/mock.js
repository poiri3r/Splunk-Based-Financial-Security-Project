// 목 서버. api.js의 transport()가 USE_MOCK일 때 handle(request)를 호출한다.
// 반드시 진짜 Response를 돌려줘 실제 서버와 같은 파싱·오류 처리 경로를 타게 한다.
//
// 상태는 sessionStorage에 저장한다(멀티 페이지라 메모리는 페이지 이동 시 사라진다).
//   mock-db    : 사용자·계좌·거래·토큰·멱등키 기록 (JSON)
//   mock-fault : 장애 주입 모드. 한 번 적용되면 'none'으로 돌아간다.
//
// 금액은 서버의 BigDecimal을 흉내 내기 위해 내부에서 BigInt(1/100원 단위)로 계산하고,
// 응답 JSON에는 소수 두 자리 숫자 리터럴(예: 100000.00)로 넣는다.

import { TIMEOUT_MS } from '../assets/js/config.js';

const DB_KEY = 'mock-db';
const FAULT_KEY = 'mock-fault';
const TOKEN_TTL_SEC = 28800;
const BALANCE_LIMIT_CENTS = 9999999999999999999n; // 99999999999999999.99
const MSG_INVALID = '입력값의 필수 여부와 형식을 확인해 주세요.';

// [모드, 설명] — 배열로 둬서 표시 순서를 고정한다.
export const FAULTS = [
  ['none', '정상 동작'],
  ['network', '다음 요청 1회: 네트워크 오류 (처리 안 함)'],
  ['commit-then-502', '다음 입금·송금 1회: 커밋 후 502'],
  ['timeout', '다음 요청 1회: 타임아웃 (처리 안 함)'],
  ['500', '다음 요청 1회: 500 INTERNAL_ERROR (처리 안 함)'],
];
const isFault = (mode) => FAULTS.some(([m]) => m === mode);

// ---------------------------------------------------------------------------
// DB

function seed() {
  return {
    users: {
      alice: { password: 'DemoPass123!' },
      bob: { password: 'DemoPass456!' },
    },
    // 삽입 순서 = 개설 순서. balance는 1/100원 단위 BigInt 문자열.
    accounts: {
      '10010001': { owner: 'alice', balance: '10000000' },
      '10010002': { owner: 'bob', balance: '5000000' },
    },
    transactions: {}, // 계좌번호 → 최신순 배열
    tokens: {}, // token → { username, expiresAt }
    idempotency: {}, // username → { key → { fingerprint, status, body } }
  };
}

function loadDb() {
  try {
    const db = JSON.parse(sessionStorage.getItem(DB_KEY));
    if (db && db.users && db.accounts) return db;
  } catch { /* 초기화 */ }
  const db = seed();
  saveDb(db);
  return db;
}

function saveDb(db) {
  sessionStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function resetDb() {
  saveDb(seed());
  setFault('none');
  log('목 DB 초기화');
}

// ---------------------------------------------------------------------------
// 장애 주입

export function getFault() {
  const mode = sessionStorage.getItem(FAULT_KEY);
  return isFault(mode) ? mode : 'none';
}

export function setFault(mode) {
  sessionStorage.setItem(FAULT_KEY, isFault(mode) ? mode : 'none');
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mock-fault-change'));
}

function log(text) {
  console.info(`[mock] ${text}`);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mock-log', { detail: text }));
}

// ---------------------------------------------------------------------------
// 유틸

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (x) => x.toString(16).padStart(2, '0')).join('');
}

function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

// JSON 숫자 리터럴로 금액을 넣기 위한 표식. toJson()이 따옴표를 벗긴다.
const DEC_MARK = '@@DEC@@';
function dec(cents) {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  return `${DEC_MARK}${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
function toJson(value) {
  return JSON.stringify(value).replace(new RegExp(`"${DEC_MARK}(-?\\d+\\.\\d{2})"`, 'g'), '$1');
}

// JSON 숫자 → 1/100원 BigInt. 형식 위반이면 null. (최소 0.01, 소수 최대 두 자리)
function toCents(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount));
  if (!m) return null; // 음수, 소수 세 자리 이상, 지수 표기
  const cents = BigInt(m[1]) * 100n + BigInt((m[2] || '').padEnd(2, '0'));
  return cents >= 1n ? cents : null;
}

// ---------------------------------------------------------------------------
// 응답

function json(status, value) {
  return new Response(toJson(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function error(status, code, message, field) {
  const body = { code, message };
  if (field) body.field = field; // 특정할 수 없으면 키 자체를 생략한다
  return json(status, body);
}

// 입력 오류가 여러 개면 필드명 순으로 한 건만 반환한다.
function firstInvalid(fields) {
  const bad = Object.keys(fields).filter((name) => fields[name]).sort();
  return bad.length ? error(400, 'INVALID_INPUT', MSG_INVALID, bad[0]) : null;
}

const accountNotFound = () => error(404, 'ACCOUNT_NOT_FOUND', '계좌를 찾을 수 없습니다.');
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

// ---------------------------------------------------------------------------
// 핸들러: (ctx) => Response. ctx = { db, user, params, body, headers }

function register({ db, body }) {
  const { username, password } = body;
  const invalid = firstInvalid({
    username: !(typeof username === 'string' && /^[A-Za-z0-9_]{3,32}$/.test(username)),
    password: !(typeof password === 'string' && password.length >= 12 && password.length <= 64
      && new TextEncoder().encode(password).length <= 72),
  });
  if (invalid) return invalid;
  if (db.users[username]) return error(409, 'DUPLICATE_USERNAME', '이미 사용 중인 아이디입니다.');
  db.users[username] = { password };
  saveDb(db);
  return new Response(null, { status: 201 });
}

function login({ db, body }) {
  const { username, password } = body;
  const invalid = firstInvalid({ username: !isNonEmptyString(username), password: !isNonEmptyString(password) });
  if (invalid) return invalid;
  const user = Object.hasOwn(db.users, username) ? db.users[username] : null;
  if (!user || user.password !== password) {
    return error(401, 'UNAUTHORIZED', '아이디 또는 비밀번호가 올바르지 않습니다.');
  }
  const now = Date.now();
  for (const [t, info] of Object.entries(db.tokens)) if (info.expiresAt <= now) delete db.tokens[t];
  const token = randomHex(32);
  db.tokens[token] = { username, expiresAt: now + TOKEN_TTL_SEC * 1000 };
  saveDb(db);
  return json(200, { token, tokenType: 'Bearer', expiresIn: TOKEN_TTL_SEC });
}

function listAccounts({ db, user }) {
  const list = Object.entries(db.accounts)
    .filter(([, a]) => a.owner === user)
    .map(([number, a]) => ({ number, balance: dec(BigInt(a.balance)) }));
  return json(200, list);
}

function openAccount({ db, user }) {
  let number;
  do {
    number = `2${Array.from(crypto.getRandomValues(new Uint8Array(15)), (x) => x % 10).join('')}`;
  } while (db.accounts[number]);
  db.accounts[number] = { owner: user, balance: '0' };
  saveDb(db);
  return json(201, { number, balance: dec(0n) });
}

function ownedAccount(db, user, number) {
  const account = Object.hasOwn(db.accounts, number) ? db.accounts[number] : null;
  return account && account.owner === user ? account : null;
}

function balance({ db, user, params }) {
  const account = ownedAccount(db, user, params[0]);
  if (!account) return accountNotFound();
  return json(200, { number: params[0], balance: dec(BigInt(account.balance)) });
}

function transactions({ db, user, params }) {
  if (!ownedAccount(db, user, params[0])) return accountNotFound();
  const list = (db.transactions[params[0]] || []).map((t) => ({
    transferId: t.transferId,
    counterparty: t.counterparty,
    amount: dec(BigInt(t.amount)),
    createdAt: t.createdAt,
  }));
  return json(200, list);
}

function addTransaction(db, number, tx) {
  (db.transactions[number] ||= []).unshift(tx);
}

// 멱등 처리 공통.
// 같은 키·같은 본문 → 저장된 응답 재반환(잔액 변화 없음)
// 같은 키·다른 본문 → 409
// 새 키 → execute() 실행. 2xx일 때만 기록한다(실패 거래는 서버에서 키 기록도 롤백된다).
function idempotent(ctx, fingerprint, execute) {
  const { db, user, headers } = ctx;
  const key = headers.get('Idempotency-Key');
  if (!key || !UUID_RE.test(key)) {
    return error(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key 헤더에 UUID를 넣어 주세요.');
  }
  const store = (db.idempotency[user] ||= {});
  const saved = store[key];
  if (saved) {
    if (saved.fingerprint !== fingerprint) {
      return error(409, 'IDEMPOTENCY_KEY_CONFLICT', '같은 요청 키로 다른 요청을 보낼 수 없습니다.');
    }
    log(`멱등키 ${key.slice(0, 8)}… 재요청 → 저장된 결과 반환 (잔액 변화 없음)`);
    return new Response(saved.body, { status: saved.status, headers: { 'Content-Type': 'application/json' } });
  }
  const result = execute();
  if (result.error) return result.error;
  const body = toJson(result.value);
  store[key] = { fingerprint, status: 200, body };
  saveDb(db);
  ctx.committed = true;
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function deposit(ctx) {
  const { db, user, body } = ctx;
  const cents = toCents(body.amount);
  const invalid = firstInvalid({ accountNumber: !isNonEmptyString(body.accountNumber), amount: cents === null });
  if (invalid) return invalid;
  const number = body.accountNumber;

  return idempotent(ctx, `deposit|${number}|${cents}`, () => {
    const account = ownedAccount(db, user, number);
    if (!account) return { error: accountNotFound() };
    const next = BigInt(account.balance) + cents;
    if (next > BALANCE_LIMIT_CENTS) {
      return { error: error(409, 'BALANCE_LIMIT_EXCEEDED', '입금 후 잔액이 허용 한도를 초과합니다.') };
    }
    const depositId = uuid();
    account.balance = String(next);
    addTransaction(db, number, {
      transferId: depositId, counterparty: 'SIMULATED_CASH_DEPOSIT', amount: String(cents), createdAt: nowIso(),
    });
    return { value: { depositId, status: 'completed', source: 'simulated_cash' } };
  });
}

function transfer(ctx) {
  const { db, user, body } = ctx;
  const cents = toCents(body.amount);
  const invalid = firstInvalid({
    amount: cents === null,
    fromAccount: !isNonEmptyString(body.fromAccount),
    toAccount: !isNonEmptyString(body.toAccount),
  });
  if (invalid) return invalid;
  const { fromAccount, toAccount } = body;

  return idempotent(ctx, `transfer|${fromAccount}|${toAccount}|${cents}`, () => {
    if (fromAccount === toAccount) {
      return { error: error(400, 'SAME_ACCOUNT', '출금 계좌와 입금 계좌가 같습니다.') };
    }
    const from = ownedAccount(db, user, fromAccount);
    const to = Object.hasOwn(db.accounts, toAccount) ? db.accounts[toAccount] : null;
    if (!from || !to) return { error: accountNotFound() };
    const fromNext = BigInt(from.balance) - cents;
    if (fromNext < 0n) return { error: error(409, 'INSUFFICIENT_BALANCE', '잔액이 부족합니다.') };
    const toNext = BigInt(to.balance) + cents;
    if (toNext > BALANCE_LIMIT_CENTS) {
      return { error: error(409, 'BALANCE_LIMIT_EXCEEDED', '입금 후 잔액이 허용 한도를 초과합니다.') };
    }
    const transferId = uuid();
    const createdAt = nowIso();
    from.balance = String(fromNext);
    to.balance = String(toNext);
    addTransaction(db, fromAccount, { transferId, counterparty: toAccount, amount: String(-cents), createdAt });
    addTransaction(db, toAccount, { transferId, counterparty: fromAccount, amount: String(cents), createdAt });
    return { value: { transferId, status: 'completed' } };
  });
}

const health = () => json(200, { status: 'ok' });

// [메서드, 경로, 핸들러, 인증 필요, JSON 본문 필요]
const ROUTES = [
  ['POST', /^\/api\/auth\/register$/, register, false, true],
  ['POST', /^\/api\/auth\/login$/, login, false, true],
  ['GET', /^\/api\/accounts$/, listAccounts, true, false],
  ['POST', /^\/api\/accounts$/, openAccount, true, false],
  ['GET', /^\/api\/accounts\/([^/]+)\/balance$/, balance, true, false],
  ['GET', /^\/api\/accounts\/([^/]+)\/transactions$/, transactions, true, false],
  ['POST', /^\/api\/deposits$/, deposit, true, true],
  ['POST', /^\/api\/transfers$/, transfer, true, true],
  ['GET', /^\/health$/, health, false, false],
];

function authenticate(db, headers) {
  const m = /^Bearer (\S+)$/.exec(headers.get('Authorization') || '');
  if (!m) return null;
  const info = Object.hasOwn(db.tokens, m[1]) ? db.tokens[m[1]] : null;
  return info && info.expiresAt > Date.now() ? info.username : null;
}

function route(method, path, headers, rawBody, ctx) {
  const matched = ROUTES.filter(([, re]) => re.test(path));
  if (!matched.length) return error(404, 'NOT_FOUND', '요청한 경로를 찾을 수 없습니다.');
  const found = matched.find(([m]) => m === method);
  if (!found) return error(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청 방식입니다.');
  const [, re, handler, needsAuth, needsBody] = found;

  const db = loadDb();
  let user = null;
  if (needsAuth) {
    user = authenticate(db, headers);
    if (!user) return error(401, 'UNAUTHORIZED', '로그인이 필요하거나 인증이 만료되었습니다.');
  }

  let params;
  try {
    params = re.exec(path).slice(1).map(decodeURIComponent);
  } catch {
    return error(400, 'REQUEST_ERROR', '요청 경로가 올바르지 않습니다.');
  }

  let body = null;
  if (needsBody) {
    if (!(headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
      return error(415, 'UNSUPPORTED_MEDIA_TYPE', '지원하지 않는 요청 형식입니다.');
    }
    try {
      body = JSON.parse(rawBody);
    } catch {
      return error(400, 'INVALID_INPUT', MSG_INVALID); // JSON 구문 오류에는 field가 없다
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return error(400, 'INVALID_INPUT', MSG_INVALID);
  }

  Object.assign(ctx, { db, user, params, body, headers });
  return handler(ctx);
}

// ---------------------------------------------------------------------------
// 진입점

export async function handle(request) {
  const { pathname } = new URL(request.url);
  const { method, headers, signal } = request;
  const rawBody = await request.text();
  const label = `${method} ${pathname}`;
  const isTx = method === 'POST' && (pathname === '/api/deposits' || pathname === '/api/transfers');

  // 1회성 장애(처리하지 않음)
  const fault = getFault();
  if (fault === 'network' || fault === 'timeout' || fault === '500') {
    setFault('none');
    if (fault === 'network') {
      await delay(300, signal);
      log(`${label} → [장애] 네트워크 오류 (처리 안 함)`);
      throw new TypeError('Failed to fetch');
    }
    if (fault === 'timeout') {
      log(`${label} → [장애] 응답 지연 ${TIMEOUT_MS + 2000}ms (처리 안 함)`);
      await delay(TIMEOUT_MS + 2000, signal); // 클라이언트 타임아웃이 먼저 abort한다
    } else {
      await delay(300, signal);
      log(`${label} → [장애] 500 (처리 안 함)`);
      return error(500, 'INTERNAL_ERROR', '서버 내부 오류가 발생했습니다.');
    }
  }

  await delay(200 + Math.random() * 400, signal);

  const ctx = { committed: false };
  const response = route(method, pathname, headers, rawBody, ctx);

  // 커밋까지 끝낸 뒤 프록시가 502를 돌려준 상황. 새로 처리된 입금·송금에만 적용한다.
  if (isTx && ctx.committed && getFault() === 'commit-then-502') {
    setFault('none');
    log(`${label} → 처리·커밋 완료, [장애] 502 HTML 반환`);
    return new Response(
      '<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>',
      { status: 502, headers: { 'Content-Type': 'text/html' } },
    );
  }

  log(`${label} → ${response.status}`);
  return response;
}

// 개발 패널(장애 주입·DB 리셋)은 목 모드에서만 붙는다.
if (typeof document !== 'undefined') {
  import('./devpanel.js').then((m) => m.mount());
}
