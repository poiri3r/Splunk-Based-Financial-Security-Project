// 목 서버. api.js의 transport()가 USE_MOCK일 때 handle(request)를 호출한다.
// 반드시 진짜 Response를 돌려줘 실제 서버와 같은 파싱·오류 처리 경로를 타게 한다.
// 계약은 백엔드 v6.1(backend/ 소스의 Controller·DTO·Service, docs/V6_1_CHANGES.md)을 따른다. 실서버 확인을 대신하지 않는다.
//
// 상태는 sessionStorage에 저장한다(멀티 페이지라 메모리는 페이지 이동 시 사라진다).
//   mock-db    : 사용자·계좌·원장·토큰·멱등키·예적금 등 (JSON)
//   mock-fault : 장애 주입 모드. 한 번 적용되면 'none'으로 돌아간다.
//
// 금액은 서버의 BigDecimal을 흉내 내기 위해 내부에서 BigInt(1/100원 단위)로 계산하고, 응답에는 십진 문자열("1000.00")로 넣는다.
// 서버의 트랜잭션 롤백은 흉내 내지 않는다. 그래서 각 핸들러는 모든 검사를 끝낸 뒤에만 상태를 바꾼다.
// 예외: 로그인 실패·PIN 오류·인증번호 오류 횟수는 서버도 실패 응답과 함께 저장한다(noRollbackFor).
// 단순화: 요청 제한(429)은 인증번호 재요청(1분 1회), step-up(비밀번호 실패 5분 5회 + 전체 1분 30회, Retry-After),
// 예적금 비밀번호 확인(5분 5회)만 흉내 낸다.

import { TIMEOUT_MS } from '../assets/js/config.js';

const DB_KEY = 'mock-db';
// DB 구조가 바뀌면 올린다. 저장된 DB의 버전이 다르면 초기 데이터로 다시 만든다.
const DB_VERSION = 3;
const FAULT_KEY = 'mock-fault';
const TOKEN_TTL_SEC = 28800;
const IDLE_SEC = 600;
const GRANT_SEC = 300;
const MAX_BALANCE = 9999999999999999999n; // 99999999999999999.99
const MSG_INVALID = '입력값의 필수 여부와 형식을 확인해 주세요.';

const SIGNUP_TERMS = { SERVICE: '2026-10-v1', PRIVACY: '2026-10-v1' };
const CHECKING_TERMS = 'MOCK-CHECKING-2026-v1';
const SAVINGS_TERMS = 'MOCK-SAVINGS-2026-v1';
const TERMS_LIST = [
  { id: 'CHECKING', version: CHECKING_TERMS, required: false, scope: 'ACCOUNT_OPEN', text: '교육용 입출금통장입니다. 실제 입금이나 실명확인을 제공하지 않습니다.' },
  { id: 'SERVICE', version: SIGNUP_TERMS.SERVICE, required: true, text: '프로젝트 시연용 서비스 약관 초안입니다. 실제 금융거래를 제공하지 않습니다.' },
  { id: 'PRIVACY', version: SIGNUP_TERMS.PRIVACY, required: true, text: '프로젝트 시연용 개인정보 처리 동의 초안입니다. 가입 정보와 거래 시연 기록을 저장합니다. 실제 운영 전 별도 검토가 필요합니다.' },
];
const PRODUCTS = [
  { productId: 'MOCK-DEPOSIT-12', name: '모의 정기예금', accountType: 'TERM_DEPOSIT', months: 12, annualRate: '0.030000', earlyRate: '0.010000', minimum: '10000.00', maximum: '1000000.00', termsVersion: SAVINGS_TERMS, termsText: '교육용 모의 상품. 단리·실제 일수/365, 세금 0, 만기 이후 이자 없음. 자동 해지 없음.' },
  { productId: 'MOCK-SAVINGS-12', name: '모의 정기적금', accountType: 'INSTALLMENT_SAVINGS', months: 12, annualRate: '0.040000', earlyRate: '0.010000', minimum: '1000.00', maximum: '1000000.00', termsVersion: SAVINGS_TERMS, termsText: '교육용 모의 상품. 가입일 기준 매월 정액 수동 납입. 월 1회, 누락 회차 소급 납입 불가. 단리·실제 일수/365, 세금 0, 자동이체 없음.' },
];

// [모드, 설명] — 배열로 둬서 표시 순서를 고정한다.
export const FAULTS = [
  ['none', '정상 동작'],
  ['network', '다음 요청 1회: 네트워크 오류 (처리 안 함)'],
  ['commit-then-502', '다음 멱등 요청 1회(가입·개설·입금·이체·예적금): 커밋 후 502'],
  ['timeout', '다음 요청 1회: 타임아웃 (처리 안 함)'],
  ['500', '다음 요청 1회: 500 INTERNAL_ERROR (처리 안 함)'],
];
const isFault = (mode) => FAULTS.some(([m]) => m === mode);

// ---------------------------------------------------------------------------
// 유틸

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (x) => x.toString(16).padStart(2, '0')).join('');
}

// 서버의 secret(): 32바이트 base64url
function secret() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_ANY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const isoAt = (ms) => new Date(ms).toISOString();
const nowIso = () => isoAt(Date.now());
const randomDigits = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => x % 10).join('');

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

// ---- 금액 ----
const money = (cents) => {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};
const cents = (text) => {
  const [i, f = ''] = String(text).replace('-', '').split('.');
  const v = BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2));
  return String(text).startsWith('-') ? -v : v;
};
// v2 금액 입력: JSON 문자열만 허용(MoneyStringDeserializer). 숫자면 본문 해석 오류로 본다.
const MONEY_RE = /^(0|[1-9]\d{0,16})(\.\d{1,2})?$/;

// ---- 한국 날짜 ----
const kstFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => kstFormat.format(new Date());
const kstDateOf = (ms) => kstFormat.format(new Date(ms));
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10);
// Java LocalDate.plusMonths: 날짜가 넘치면 그 달 말일로 맞춘다.
function plusMonths(day, months) {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return fmtDay(target.getTime());
}
const plusYears = (day, years) => plusMonths(day, years * 12);
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
// 한국 날짜 하루의 시작 시각(ms)
const kstStart = (day) => parseDay(day) - 9 * 3600 * 1000;

// ---------------------------------------------------------------------------
// DB

function seed() {
  const db = {
    version: DB_VERSION, seq: 0,
    users: {}, accounts: {}, ledger: [], tokens: {}, challenges: {}, recoveryCodes: {}, recoveryGrants: {},
    previews: {}, transferActions: {}, transferRecords: {}, settingActions: {}, idempotency: {},
    savings: {}, beneficiaries: {}, limitUsage: {}, consents: {}, rate: {}, inbox: [],
  };
  // 백엔드 demo 프로필(DemoData.java)과 같은 초기값
  const fixtures = [
    ['alice', 'Demo!Alice7392', '김시연', '+821090002951', '2000000000000001', '4826', '100000.00'],
    ['bob', 'Demo!Bob5837', '이시연', '+821090002963', '2000000000000002', '7391', '50000.00'],
  ];
  for (const [username, password, name, phone, number, pin, balance] of fixtures) {
    db.users[username] = newUser(password, name);
    Object.assign(db.users[username], { phone, phoneAssurance: 'SIMULATED' });
    createAccount(db, username, { number, balance: cents(balance), pin });
  }
  return db;
}

function newUser(password, name) {
  return {
    customerId: uuid(), password, name, email: null, phone: null,
    emailAssurance: 'UNVERIFIED', phoneAssurance: 'UNVERIFIED', profileVersion: 0, authVersion: 0, loginFailures: 0,
    perTransfer: String(100000000n), daily: String(500000000n), limitVersion: 0,
  };
}

function createAccount(db, owner, { number, balance = 0n, pin = null, accountName = '프로젝트 입출금통장', accountType = 'CHECKING', debitEnabled = true }) {
  const id = uuid();
  db.accounts[id] = {
    number, owner, balance: String(balance), accountName, accountType, currency: 'KRW', status: 'ACTIVE',
    openedAt: nowIso(), alias: null, hidden: false, order: 0, debitEnabled, pin, pinFailures: 0,
    settingsVersion: 0, securityVersion: 0, seq: ++db.seq,
  };
  return id;
}

function loadDb() {
  try {
    const db = JSON.parse(sessionStorage.getItem(DB_KEY));
    if (db && db.version === DB_VERSION && db.users && db.accounts) return db;
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

// 개발 패널: 로그인 세션을 유휴 10분이 지난 상태로 만든다(유휴 만료 화면 확인용).
export function expireSessions() {
  const db = loadDb();
  for (const t of Object.values(db.tokens)) t.lastActivityAt = Date.now() - (IDLE_SEC + 1) * 1000;
  saveDb(db);
  log('모든 로그인 세션을 유휴 만료 상태로 바꿈');
}

// 개발 패널: 최근 모의 인증번호 (실서버의 모의 수신함 API를 흉내 낸다)
export function getInbox() {
  return loadDb().inbox;
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
// 응답·오류

function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
const empty = (status = 204) => new Response(null, { status });

class Fail extends Error {
  constructor(status, code, message, field, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
    this.headers = headers; // 예: step-up 제한의 Retry-After
  }
}
const fail = (status, code, message, field, headers) => { throw new Fail(status, code, message, field, headers); };
const invalid = (field, message = MSG_INVALID) => fail(400, 'INVALID_INPUT', message, field);

// DTO 검증: 여러 필드가 틀리면 필드명 순으로 한 건만 (ApiErrors.handleMethodArgumentNotValid)
function check(fields) {
  const bad = Object.keys(fields).filter((name) => fields[name]).sort();
  if (bad.length) invalid(bad[0]);
}

const str = (v) => typeof v === 'string';
const blank = (v) => !str(v) || v.trim() === '';
const tooLong = (v, max) => str(v) && v.length > max;
const optPattern = (v, re) => v !== undefined && v !== null && !(str(v) && re.test(v));
// 금액 필드가 숫자로 오면 서버는 필드 없는 JSON 오류를 낸다.
function moneyField(v, field, re = MONEY_RE) {
  if (v !== undefined && v !== null && !str(v)) fail(400, 'INVALID_INPUT', 'JSON 본문과 필드 자료형을 확인해 주세요.');
  return !(str(v) && re.test(v)) ? field : null;
}

// ---------------------------------------------------------------------------
// 공통 규칙 (CredentialPolicy, AccountPolicy, IdentityService)

const SEQUENCES = ['0123456789', '9876543210', 'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba'];
function predictable(value) {
  const lower = value.toLowerCase();
  for (let i = 0; i + 4 <= lower.length; i++) {
    const part = lower.slice(i, i + 4);
    if (new Set(part).size === 1 || SEQUENCES.some((s) => s.includes(part))) return true;
  }
  return false;
}
const weak = (field) => fail(400, 'WEAK_CREDENTIAL', '반복·연속·개인정보를 피한 비밀번호를 입력해 주세요.', field);
function passwordPolicy(value, username, phone, field = 'password') {
  if (!str(value) || value.length < 12 || value.length > 64 || new TextEncoder().encode(value).length > 72
    || !/[A-Za-z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9\s]/.test(value) || CONTROL_RE.test(value)
    || value.toLowerCase() === String(username).toLowerCase() || predictable(value)
    || (phone && value.includes(phone.slice(-4)))) weak(field);
}
function pinPolicy(pin, phone) {
  if (!str(pin) || !/^\d{4}$/.test(pin) || predictable(pin) || (phone && phone.includes(pin))) weak('pin');
}
function banking(u) {
  if (!u.name || !u.phone || u.phoneAssurance !== 'SIMULATED') fail(403, 'BANKING_SETUP_REQUIRED', '이름과 모의 휴대폰 확인을 완료해 주세요.');
}
function normalizePhone(value) {
  let v = String(value).trim().replace(/[ -]/g, '');
  if (/^0\d{8,10}$/.test(v)) v = `+82${v.slice(1)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(v)) invalid();
  return v;
}
function reauth(u, password) {
  if (!str(password) || new TextEncoder().encode(password).length > 72 || password !== u.password) {
    fail(401, 'REAUTHENTICATION_FAILED', '비밀번호가 올바르지 않습니다.');
  }
}
// 비밀번호 변경·복구·PIN 재설정: 모든 로그인·승인 권한·복구 코드 폐기 (IdentityService.revoke)
function revokeAll(db, username) {
  const u = db.users[username];
  u.authVersion += 1;
  for (const [t, info] of Object.entries(db.tokens)) if (info.username === username) delete db.tokens[t];
  for (const a of Object.values(db.transferActions)) if (a.username === username) a.consumed = true;
  for (const a of Object.values(db.settingActions)) if (a.username === username) a.consumed = true;
  for (const c of Object.values(db.challenges)) if (c.owner === username) c.consumed = true;
  for (const c of Object.values(db.recoveryCodes)) if (c.username === username) c.consumed = true;
}

const pinLocked = (a) => a.pinFailures >= 4;
function debitAllowed(a) {
  if (!a.pin) fail(403, 'ACCOUNT_PIN_REQUIRED', '계좌 비밀번호를 먼저 등록해 주세요.');
  if (!a.debitEnabled) fail(409, 'DEBIT_DISABLED', '출금 등록이 해제된 계좌입니다.');
  if (pinLocked(a)) fail(423, 'PIN_LOCKED', '계좌 비밀번호가 잠겨 있습니다.');
}
// PIN 오류 횟수는 실패 응답과 함께 저장된다(handle()이 오류 응답에도 DB를 저장한다).
function verifyPin(a, pin) {
  if (pinLocked(a)) fail(423, 'PIN_LOCKED', '계좌 비밀번호가 잠겨 있습니다.');
  if (!a.pin) fail(403, 'ACCOUNT_PIN_REQUIRED', '계좌 비밀번호를 먼저 등록해 주세요.');
  if (pin === undefined || pin === null) fail(403, 'ACCOUNT_PIN_REQUIRED', '계좌 비밀번호가 필요합니다.');
  if (pin !== a.pin) {
    a.pinFailures += 1;
    if (a.pinFailures >= 4) {
      a.securityVersion += 1;
      fail(423, 'PIN_LOCKED', '계좌 비밀번호가 잠겼습니다. 본인확인 후 재설정해 주세요.');
    }
    fail(403, 'PIN_INVALID', '계좌 비밀번호가 올바르지 않습니다.');
  }
  a.pinFailures = 0;
}
// 사용자별 고정 창 요청 제한 (TransferRequestLimiter)
function limit(db, key, max, seconds) {
  const now = Date.now();
  const w = db.rate[key];
  if (!w || w.until <= now) { db.rate[key] = { until: now + seconds * 1000, count: 1 }; return; }
  if (w.count >= max) fail(429, 'RATE_LIMITED', '잠시 후 다시 시도해 주세요.');
  w.count += 1;
}
const conflict = (code) => fail(409, code, '상품 상태 또는 거래 조건을 확인하고 다시 조회해 주세요.');
const checking = (a) => { if (a.accountType !== 'CHECKING') conflict('PRODUCT_ACCOUNT_RESTRICTED'); };

function used(db, username) {
  return BigInt(db.limitUsage[`${username}:${today()}`] ?? '0');
}
function checkLimits(db, username, amount) {
  const u = db.users[username];
  if (amount > BigInt(u.perTransfer)) fail(409, 'PER_TRANSFER_LIMIT_EXCEEDED', '1회 이체한도를 초과합니다.');
  if (used(db, username) + amount > BigInt(u.daily)) fail(409, 'DAILY_LIMIT_EXCEEDED', '오늘의 이체한도를 초과합니다.');
}
function consumeLimit(db, username, amount) {
  checkLimits(db, username, amount);
  db.limitUsage[`${username}:${today()}`] = String(used(db, username) + amount);
}

// 잔액 이동 + 원장 2건. 잔액 변경 후의 값을 balanceAfter로 남긴다.
function move(db, fromId, toId, amount) {
  const from = db.accounts[fromId];
  const to = db.accounts[toId];
  if (BigInt(to.balance) + amount > MAX_BALANCE) fail(409, 'BALANCE_LIMIT_EXCEEDED', '입금 계좌의 잔액 상한을 초과합니다.');
  from.balance = String(BigInt(from.balance) - amount);
  to.balance = String(BigInt(to.balance) + amount);
  const transferId = uuid();
  const createdAt = nowIso();
  addEntry(db, fromId, { transferId, counterparty: to.number, amount: -amount, createdAt });
  addEntry(db, toId, { transferId, counterparty: from.number, amount, createdAt });
  return { transferId, fromBalance: BigInt(from.balance) };
}
function addEntry(db, accountId, { transferId, counterparty, amount, createdAt }) {
  db.ledger.push({
    seq: ++db.seq, entryId: uuid(), accountId, transferId, counterparty,
    amount: String(amount), balanceAfter: db.accounts[accountId].balance, createdAt,
  });
}

// ---------------------------------------------------------------------------
// 조회 형태

const settingsView = (id, a) => ({
  accountId: id, alias: a.alias, hidden: a.hidden, order: a.order, debitEnabled: a.debitEnabled,
  pinConfigured: Boolean(a.pin), pinLocked: pinLocked(a), pinLockedUntil: null, version: a.settingsVersion,
});
const accountView = (id, a) => ({
  accountId: id, number: a.number, accountName: a.accountName, accountType: a.accountType, currency: a.currency,
  status: a.status, balance: money(BigInt(a.balance)),
  availableBalance: a.status === 'ACTIVE' && a.debitEnabled && a.pin && !pinLocked(a) ? money(BigInt(a.balance)) : '0.00',
  openedAt: a.openedAt, preferences: settingsView(id, a),
});
const customerView = (username, u) => ({
  customerId: u.customerId, username, name: u.name, email: u.email, phone: u.phone,
  emailVerified: false, phoneVerified: false, version: u.profileVersion,
  emailAssurance: u.emailAssurance, phoneAssurance: u.phoneAssurance,
  bankingReady: Boolean(u.name && u.phone && u.phoneAssurance === 'SIMULATED'),
});

function ownedAccount(db, user, id, code = 'ACCOUNT_NOT_FOUND') {
  if (!UUID_ANY_RE.test(String(id))) invalid(undefined, '요청 경로, 방식과 형식을 확인해 주세요.');
  const a = db.accounts[id];
  if (!a || a.owner !== user) fail(404, code, '계좌가 없거나 접근할 수 없습니다.');
  return a;
}
const accountByNumber = (db, number) => Object.entries(db.accounts).find(([, a]) => a.number === number) ?? null;

function maskName(name) {
  if (!name) return '이름 미등록';
  const chars = [...name];
  return chars.length <= 1 ? '*' : chars[0] + '*'.repeat(chars.length - 1);
}

// ---------------------------------------------------------------------------
// 멱등 처리 공통
// 같은 키·같은 요청 → 저장된 응답 재반환(상태 변화 없음) / 같은 키·다른 요청 → 409 / 새 키 → 실행 후 성공만 기록

// v6.1: 7개 멱등 POST 모두 키 누락·형식 오류는 400 IDEMPOTENCY_KEY_INVALID (DTO 검증 뒤에 검사한다)
function idempotent(ctx, { scope, op, status = 200 }, execute) {
  const { db, headers, rawBody } = ctx;
  const key = headers.get('Idempotency-Key');
  if (!key || !UUID_RE.test(key)) fail(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key는 소문자 표준 UUID여야 합니다.');
  const store = (db.idempotency[scope] ||= {});
  const saved = store[key];
  if (saved) {
    if (saved.op !== op || saved.fingerprint !== rawBody + ctx.path) fail(409, 'IDEMPOTENCY_KEY_CONFLICT', '같은 키가 다른 요청에 사용되었습니다.');
    log(`멱등키 ${key.slice(0, 8)}… 재요청 → 저장된 결과 반환 (상태 변화 없음)`);
    return new Response(saved.body, { status: saved.status, headers: { 'Content-Type': 'application/json' } });
  }
  const body = JSON.stringify(execute());
  store[key] = { op, fingerprint: rawBody + ctx.path, status, body };
  ctx.committed = true;
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

// ---------------------------------------------------------------------------
// 커서 (서버는 HMAC 서명. 목은 조건 일치만 확인한다)

const encodeCursor = (p) => btoa(unescape(encodeURIComponent(JSON.stringify(p))));
function decodeCursor(cursor, scope, from, to, type) {
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(cursor))));
    if (p.scope !== scope || p.from !== from || p.to !== to || p.type !== type) throw new Error();
    return p;
  } catch {
    return invalid('cursor', '조회 조건과 페이지 정보를 확인해 주세요.');
  }
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function range(query) {
  const toQ = query.get('to');
  const fromQ = query.get('from');
  if ((toQ && !DAY_RE.test(toQ)) || (fromQ && !DAY_RE.test(fromQ))) invalid();
  const to = toQ || today();
  const from = fromQ || plusMonths(to, -1);
  if (from > to || to > plusYears(from, 1)) invalid('from', '시작일과 종료일은 최대 1년 범위로 입력해 주세요.');
  const size = query.has('size') ? Number(query.get('size')) : 20;
  if (!Number.isInteger(size) || size < 1 || size > 100) invalid('size', 'size는 1~100이어야 합니다.');
  return { from, to, size, start: kstStart(from), end: kstStart(plusMonths(to, 0)) + 86400000 };
}
// 최신순 정렬 후 커서 위치 다음부터 size+1개
function paginate(rows, timeOf, { size }, pos) {
  const sorted = rows.slice().sort((a, b) => (timeOf(b) - timeOf(a)) || (b.seq - a.seq));
  const after = pos ? sorted.filter((r) => timeOf(r) < pos.time || (timeOf(r) === pos.time && r.seq < pos.seq)) : sorted;
  return { page: after.slice(0, size), hasNext: after.length > size };
}

// ===========================================================================
// 핸들러: (ctx) => Response. ctx = { db, user, params, body, headers, query, token }
// ===========================================================================

// ---- 약관·연락처 확인·가입 (IdentityService) ----

const terms = () => json(200, { items: TERMS_LIST });

function startChallenge(ctx) {
  const { db, body } = ctx;
  check({
    channel: blank(body.channel) || !/^(EMAIL|SMS)$/.test(body.channel),
    contact: blank(body.contact) || tooLong(body.contact, 254),
    purpose: blank(body.purpose) || !/^(REGISTER|PROFILE)$/.test(body.purpose),
  });
  const owner = body.purpose === 'PROFILE' ? requireUser(ctx) : null;
  if (body.channel !== 'SMS') invalid('channel', '목 서버는 SMS 확인만 흉내 냅니다.');
  const contact = normalizePhone(body.contact);
  // 같은 목적·번호는 1분에 한 번 (서버: send-minute 제한)
  const rateKey = `send:${body.purpose}:${contact}`;
  if ((db.rate[rateKey] ?? 0) > Date.now()) fail(429, 'RATE_LIMITED', '잠시 후 다시 시도해 주세요.');
  db.rate[rateKey] = Date.now() + 60 * 1000;
  for (const c of Object.values(db.challenges)) {
    if (c.purpose === body.purpose && c.contact === contact && c.owner === owner && !c.verified) c.consumed = true;
  }
  const id = uuid();
  const code = randomDigits(6);
  const expiresAt = Date.now() + GRANT_SEC * 1000;
  db.challenges[id] = { purpose: body.purpose, contact, owner, code, expiresAt, failures: 0, verified: false, consumed: false, grant: null, grantExpiresAt: 0 };
  db.inbox.unshift({ at: nowIso(), purpose: body.purpose, contact, code });
  db.inbox.length = Math.min(db.inbox.length, 5);
  log(`모의 수신함: ${contact} 인증번호 ${code}`);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mock-inbox'));
  return json(202, { challengeId: id, expiresAt: isoAt(expiresAt), delivery: 'SIMULATED', inboxToken: secret() });
}

function verifyChallenge(ctx) {
  const { db, params, body } = ctx;
  if (!UUID_ANY_RE.test(params[0])) invalid();
  check({ code: blank(body.code) || !/^\d{6}$/.test(body.code) });
  const c = db.challenges[params[0]];
  if (!c || c.consumed || c.verified || c.expiresAt <= Date.now()) fail(400, 'CHALLENGE_INVALID', '인증 요청이 없거나 만료되었습니다.');
  if (c.owner && requireUser(ctx) !== c.owner) fail(404, 'NOT_FOUND', '인증 요청을 확인해 주세요.');
  if (body.code !== c.code) {
    c.failures += 1;
    if (c.failures >= 5) c.consumed = true;
    fail(400, c.consumed ? 'CHALLENGE_LOCKED' : 'CODE_INVALID', '인증번호가 올바르지 않습니다.');
  }
  c.verified = true;
  c.grant = secret();
  c.grantExpiresAt = Date.now() + GRANT_SEC * 1000;
  return json(200, { contactGrant: c.grant, expiresAt: isoAt(c.grantExpiresAt), assurance: 'SIMULATED' });
}

function contactGrant(db, raw, purpose, owner) {
  const c = Object.values(db.challenges).find((x) => x.grant && x.grant === raw);
  if (!c || !c.verified || c.consumed || c.purpose !== purpose || c.owner !== owner || c.grantExpiresAt <= Date.now()) {
    fail(403, 'CONTACT_GRANT_INVALID', '해당 목적의 연락처 인증이 필요합니다.');
  }
  return c;
}

function register(ctx) {
  const { db, body } = ctx;
  check({
    contactGrant: blank(body.contactGrant) || tooLong(body.contactGrant, 128),
    name: blank(body.name) || tooLong(body.name, 100),
    password: blank(body.password) || body.password.length < 12 || body.password.length > 64,
    termsVersions: !body.termsVersions || typeof body.termsVersions !== 'object',
    username: blank(body.username) || !/^[a-zA-Z0-9_]{3,32}$/.test(body.username),
  });
  if (new TextEncoder().encode(body.password).length > 72) invalid();
  return idempotent(ctx, { scope: 'register', op: 'REGISTER', status: 201 }, () => {
    const versions = body.termsVersions;
    if (Object.keys(versions).length !== 2 || versions.SERVICE !== SIGNUP_TERMS.SERVICE || versions.PRIVACY !== SIGNUP_TERMS.PRIVACY) {
      fail(409, 'TERMS_VERSION_REQUIRED', '현재 필수 약관에 동의해 주세요.');
    }
    const name = body.name.trim();
    if (CONTROL_RE.test(name)) invalid();
    if (Object.hasOwn(db.users, body.username)) fail(409, 'DUPLICATE_USERNAME', '이미 사용 중인 아이디입니다.');
    const c = contactGrant(db, body.contactGrant, 'REGISTER', null);
    passwordPolicy(body.password, body.username, c.contact);
    const u = newUser(body.password, name);
    Object.assign(u, { phone: c.contact, phoneAssurance: 'SIMULATED' });
    c.consumed = true;
    db.users[body.username] = u;
    const acceptedAt = nowIso();
    db.consents[body.username] = Object.entries(SIGNUP_TERMS).map(([id, version]) => ({ id, version, acceptedAt }));
    return { customerId: u.customerId };
  });
}

// ---- 로그인·세션 ----

function login({ db, body }) {
  check({ password: blank(body.password), username: blank(body.username) });
  const u = Object.hasOwn(db.users, body.username) ? db.users[body.username] : null;
  if (!u) fail(401, 'LOGIN_FAILED', '아이디 또는 비밀번호가 올바르지 않습니다.');
  if (u.loginFailures >= 3) fail(423, 'LOGIN_LOCKED', '본인확인 후 로그인 제한을 해제해 주세요.');
  if (body.password !== u.password) {
    u.loginFailures += 1;
    if (u.loginFailures >= 3) {
      u.authVersion += 1;
      for (const [t, info] of Object.entries(db.tokens)) if (info.username === body.username) delete db.tokens[t];
    }
    fail(u.loginFailures >= 3 ? 423 : 401, u.loginFailures >= 3 ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
      '아이디 또는 비밀번호가 올바르지 않거나 로그인이 제한되었습니다.');
  }
  u.loginFailures = 0;
  const now = Date.now();
  for (const [t, info] of Object.entries(db.tokens)) if (info.expiresAt <= now) delete db.tokens[t];
  const token = uuid() + uuid();
  db.tokens[token] = { username: body.username, expiresAt: now + TOKEN_TTL_SEC * 1000, lastActivityAt: now, authVersion: u.authVersion };
  return json(200, { token, tokenType: 'Bearer', expiresIn: TOKEN_TTL_SEC });
}

function logout({ db, token }) {
  delete db.tokens[token];
  return empty();
}

function sessionStatus({ db, token }) {
  const t = db.tokens[token];
  const idle = Math.min(t.lastActivityAt + IDLE_SEC * 1000, t.expiresAt);
  return json(200, { idleExpiresAt: isoAt(idle), absoluteExpiresAt: isoAt(t.expiresAt), idleTimeoutSeconds: IDLE_SEC });
}

// ---- 계정 복구 (RecoveryService) ----

const recoveryInvalid = () => fail(400, 'RECOVERY_INVALID', '복구 정보를 확인해 주세요.');

function verifyRecovery({ db, body }) {
  check({
    accountNumber: optPattern(body.accountNumber, /^\d{10,20}$/),
    method: blank(body.method) || !/^(ACCOUNT|RECOVERY_CODE)$/.test(body.method),
    name: tooLong(body.name, 100),
    pin: optPattern(body.pin, /^\d{4}$/),
    purpose: blank(body.purpose) || !/^(USERNAME|PASSWORD|LOGIN_UNLOCK)$/.test(body.purpose),
    recoveryCode: tooLong(body.recoveryCode, 128),
  });
  let username;
  if (body.method === 'ACCOUNT') {
    if (body.name == null || body.accountNumber == null || body.pin == null || body.recoveryCode != null) recoveryInvalid();
    const found = accountByNumber(db, body.accountNumber);
    if (!found) recoveryInvalid();
    const [, a] = found;
    const u = db.users[a.owner];
    if (a.accountType !== 'CHECKING' || a.status !== 'ACTIVE' || !a.pin || !u.name || u.name !== String(body.name).trim()) recoveryInvalid();
    verifyPin(a, body.pin);
    username = a.owner;
  } else {
    if (body.recoveryCode == null || body.name != null || body.accountNumber != null || body.pin != null) recoveryInvalid();
    const c = db.recoveryCodes[body.recoveryCode];
    if (!c || c.consumed) recoveryInvalid();
    c.consumed = true;
    username = c.username;
  }
  if (body.purpose === 'USERNAME') return json(200, { username });
  const token = secret();
  const expiresAt = Date.now() + GRANT_SEC * 1000;
  db.recoveryGrants[token] = { username, purpose: body.purpose, expiresAt, authVersion: db.users[username].authVersion, consumed: false };
  return json(200, { resetToken: token, expiresAt: isoAt(expiresAt), purpose: body.purpose });
}

function recoveryGrant(db, raw, purpose) {
  const g = str(raw) && Object.hasOwn(db.recoveryGrants, raw) ? db.recoveryGrants[raw] : null;
  if (!g || g.consumed || g.purpose !== purpose || g.expiresAt <= Date.now()) recoveryInvalid();
  if (!db.users[g.username] || db.users[g.username].authVersion !== g.authVersion) recoveryInvalid();
  return g;
}

function resetPassword({ db, body }) {
  check({
    newPassword: blank(body.newPassword) || body.newPassword.length < 12 || body.newPassword.length > 64,
    resetToken: blank(body.resetToken) || tooLong(body.resetToken, 128),
  });
  const g = recoveryGrant(db, body.resetToken, 'PASSWORD');
  const u = db.users[g.username];
  passwordPolicy(body.newPassword, g.username, u.phone, 'newPassword');
  if (body.newPassword === u.password) weak('newPassword');
  u.password = body.newPassword;
  u.loginFailures = 0;
  g.consumed = true;
  revokeAll(db, g.username);
  return empty();
}

function unlockLogin({ db, body }) {
  check({ resetToken: blank(body.resetToken) || tooLong(body.resetToken, 128) });
  const g = recoveryGrant(db, body.resetToken, 'LOGIN_UNLOCK');
  db.users[g.username].loginFailures = 0;
  g.consumed = true;
  revokeAll(db, g.username);
  return empty();
}

// ---- 내 정보 (CustomerService, IdentityService) ----

const getMe = ({ db, user }) => json(200, customerView(user, db.users[user]));

function updateProfile({ db, user, body }) {
  check({
    currentPassword: blank(body.currentPassword) || tooLong(body.currentPassword, 64),
    email: body.email != null && (!str(body.email) || tooLong(body.email, 254) || !/^[^\s@]+@[^\s@]+$/.test(body.email)),
    name: tooLong(body.name, 100),
    phone: tooLong(body.phone, 32),
    version: !Number.isInteger(body.version) || body.version < 0,
  });
  const u = db.users[user];
  reauth(u, body.currentPassword);
  if (body.version !== u.profileVersion) fail(409, 'PROFILE_VERSION_CONFLICT', '정보가 변경되었습니다. 다시 조회해 주세요.');
  const optional = (v, field) => {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s || CONTROL_RE.test(s)) invalid(field, '입력값의 형식을 확인해 주세요.');
    return s;
  };
  const name = optional(body.name, 'name');
  let email = optional(body.email, 'email');
  let phone = optional(body.phone, 'phone');
  if (email) {
    const at = email.lastIndexOf('@');
    if (at < 1 || at === email.length - 1) invalid('email', '입력값의 형식을 확인해 주세요.');
    email = email.slice(0, at) + email.slice(at).toLowerCase();
  }
  if (phone) {
    phone = phone.replace(/[ -]/g, '');
    if (/^0\d{8,10}$/.test(phone)) phone = `+82${phone.slice(1)}`;
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) invalid('phone', '입력값의 형식을 확인해 주세요.');
  }
  if (name == null || (u.name != null && u.name !== name)) fail(409, 'IDENTITY_CHANGE_NOT_ALLOWED', '등록한 이름은 이 화면에서 변경할 수 없습니다.');
  if (phone !== u.phone) fail(403, 'CONTACT_CONFIRMATION_REQUIRED', '연락처 변경은 모의 확인 후 적용해 주세요.');
  const changed = name !== u.name || email !== u.email;
  if (email !== u.email) u.emailAssurance = 'UNVERIFIED';
  u.name = name;
  u.email = email;
  if (changed) u.profileVersion += 1; // JPA @Version은 실제로 바뀐 경우에만 오른다
  return json(200, customerView(user, u));
}

function applyContact({ db, user, body }) {
  check({
    contactGrant: blank(body.contactGrant) || tooLong(body.contactGrant, 128),
    currentPassword: blank(body.currentPassword) || tooLong(body.currentPassword, 64),
  });
  const u = db.users[user];
  reauth(u, body.currentPassword);
  const c = contactGrant(db, body.contactGrant, 'PROFILE', user);
  u.phone = c.contact;
  u.phoneAssurance = 'SIMULATED';
  c.consumed = true;
  return empty();
}

function changePassword({ db, user, body }) {
  check({
    currentPassword: blank(body.currentPassword) || tooLong(body.currentPassword, 64),
    newPassword: blank(body.newPassword) || body.newPassword.length < 12 || body.newPassword.length > 64,
  });
  const u = db.users[user];
  reauth(u, body.currentPassword);
  passwordPolicy(body.newPassword, user, u.phone, 'newPassword'); // 72바이트 초과도 여기서 WEAK_CREDENTIAL(newPassword)
  if (body.newPassword === u.password) weak('newPassword');
  u.password = body.newPassword;
  u.loginFailures = 0;
  revokeAll(db, user);
  return empty();
}

const myTerms = ({ db, user }) => json(200, { items: db.consents[user] ?? [] });

function recoveryCodeStatus({ db, user }) {
  const remaining = Object.values(db.recoveryCodes).filter((c) => c.username === user && !c.consumed).length;
  return json(200, { remaining });
}

function issueRecoveryCodes({ db, user, body }) {
  check({ currentPassword: blank(body.currentPassword) || tooLong(body.currentPassword, 64) });
  reauth(db.users[user], body.currentPassword);
  for (const c of Object.values(db.recoveryCodes)) if (c.username === user) c.consumed = true;
  const codes = Array.from({ length: 5 }, () => secret());
  codes.forEach((code) => { db.recoveryCodes[code] = { username: user, consumed: false }; });
  return json(200, { codes, oneTimeDisplay: true });
}

// ---- 계좌 (AccountQueryService) ----

function listAccounts({ db, user, query }) {
  const includeHidden = query.get('includeHidden') === 'true';
  const items = Object.entries(db.accounts)
    .filter(([, a]) => a.owner === user && (includeHidden || !a.hidden))
    .sort(([, a], [, b]) => (a.order - b.order) || (a.seq - b.seq))
    .map(([id, a]) => accountView(id, a));
  return json(200, { items });
}

const getAccount = ({ db, user, params }) => json(200, accountView(params[0], ownedAccount(db, user, params[0])));

function openAccount(ctx) {
  const { db, user, body } = ctx;
  check({ pin: blank(body.pin) || !/^\d{4}$/.test(body.pin), termsVersion: blank(body.termsVersion) });
  return idempotent(ctx, { scope: user, op: 'OPEN_ACCOUNT', status: 201 }, () => {
    const u = db.users[user];
    banking(u);
    if (body.termsVersion !== CHECKING_TERMS) fail(409, 'TERMS_VERSION_REQUIRED', '입출금통장 약관을 확인해 주세요.');
    pinPolicy(body.pin, u.phone);
    let number;
    do number = `2${randomDigits(15)}`; while (accountByNumber(db, number));
    const id = createAccount(db, user, { number, pin: body.pin });
    return { accountId: id, number, balance: '0.00', openedAt: db.accounts[id].openedAt };
  });
}

function transactions({ db, user, params, query }) {
  ownedAccount(db, user, params[0]);
  const type = query.get('type') || 'ALL';
  if (!['ALL', 'DEPOSIT', 'WITHDRAWAL'].includes(type)) invalid();
  const r = range(query);
  const cursor = query.get('cursor');
  const pos = cursor ? decodeCursor(cursor, params[0], r.from, r.to, type) : null;
  const time = (e) => Date.parse(e.createdAt);
  const maxSeq = pos ? pos.max : db.seq;
  const rows = db.ledger.filter((e) => e.accountId === params[0] && time(e) >= r.start && time(e) < r.end && e.seq <= maxSeq
    && (type === 'ALL' || (type === 'DEPOSIT' ? BigInt(e.amount) > 0n : BigInt(e.amount) < 0n)));
  const { page, hasNext } = paginate(rows, time, r, pos);
  const last = page[page.length - 1];
  return json(200, {
    items: page.map((e) => ({
      entryId: e.entryId, transferId: e.transferId, counterparty: e.counterparty, amount: money(BigInt(e.amount)),
      direction: BigInt(e.amount) > 0n ? 'DEPOSIT' : 'WITHDRAWAL', balanceAfter: money(BigInt(e.balanceAfter)), createdAt: e.createdAt,
    })),
    nextCursor: hasNext ? encodeCursor({ scope: params[0], from: r.from, to: r.to, type, max: maxSeq, time: time(last), seq: last.seq }) : null,
    hasNext, from: r.from, to: r.to,
  });
}

// ---- 계좌 설정·한도 (AccountManagementService) ----

const settingsInvalid = () => invalid(undefined, '변경값과 버전을 확인해 주세요.');
const versionConflict = () => fail(409, 'VERSION_CONFLICT', '정보가 변경되었습니다. 다시 조회해 주세요.');
function fieldsOnly(obj, allowed) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).some((k) => !allowed.includes(k))) settingsInvalid();
}
function versionOf(obj) {
  if (!Number.isInteger(obj.version) || obj.version < 0) settingsInvalid();
  return obj.version;
}
function aliasOf(v) {
  if (v === null) return null;
  if (!str(v)) settingsInvalid();
  const s = v.trim();
  if (!s || s.length > 50 || CONTROL_RE.test(s)) settingsInvalid();
  return s;
}

const getPreferences = ({ db, user, params }) => json(200, settingsView(params[0], ownedAccount(db, user, params[0])));

function updatePreferences({ db, user, params, body }) {
  const a = ownedAccount(db, user, params[0]);
  fieldsOnly(body, ['version', 'alias', 'hidden', 'order']);
  if (versionOf(body) !== a.settingsVersion) versionConflict();
  if (!('alias' in body) && !('hidden' in body) && !('order' in body)) settingsInvalid();
  const alias = 'alias' in body ? aliasOf(body.alias) : a.alias;
  if ('hidden' in body && typeof body.hidden !== 'boolean') settingsInvalid();
  if ('order' in body && !(Number.isInteger(body.order) && body.order >= 0 && body.order <= 9999)) settingsInvalid();
  a.alias = alias;
  if ('hidden' in body) a.hidden = body.hidden;
  if ('order' in body) a.order = body.order;
  a.settingsVersion += 1;
  return json(200, settingsView(params[0], a));
}

// 승인 대상 changes의 지문. 한도 금액은 소수 둘째 자리로 맞춘 뒤 비교한다.
function intentHash(purpose, changes) {
  const c = purpose === 'TRANSFER_LIMITS'
    ? { version: changes.version, perTransfer: money(cents(changes.perTransfer)), daily: money(cents(changes.daily)) }
    : purpose === 'ACCOUNT_PIN' ? { version: changes.version, newPin: changes.newPin } : { version: changes.version, enabled: changes.enabled };
  return `${purpose}|${JSON.stringify(c)}`;
}
function parseIntent(purpose, changes) {
  const allowed = { ACCOUNT_PIN: ['version', 'newPin'], DEBIT_SETTING: ['version', 'enabled'], TRANSFER_LIMITS: ['version', 'perTransfer', 'daily'] }[purpose];
  fieldsOnly(changes, allowed);
  versionOf(changes);
  if (purpose === 'ACCOUNT_PIN' && !(str(changes.newPin) && /^\d{4}$/.test(changes.newPin))) settingsInvalid();
  if (purpose === 'DEBIT_SETTING' && typeof changes.enabled !== 'boolean') settingsInvalid();
  if (purpose === 'TRANSFER_LIMITS' && !(str(changes.perTransfer) && MONEY_RE.test(changes.perTransfer) && str(changes.daily) && MONEY_RE.test(changes.daily))) settingsInvalid();
  return changes;
}
function checkLimitChange(u, c) {
  if (c.version !== u.limitVersion) versionConflict();
  const per = cents(c.perTransfer);
  const daily = cents(c.daily);
  if (per > daily) settingsInvalid();
  if (per > BigInt(u.perTransfer) || daily > BigInt(u.daily)) fail(409, 'LIMIT_INCREASE_NOT_ALLOWED', '이 화면에서는 한도 감액만 가능합니다.');
}

// step-up 전용 제한 (StepUpLimiter, v6.1). 이체 승인·계좌 설정·한도 변경이 사용자별로 공유한다.
// - 전체 요청: 최근 1분 30회까지. 서비스에 들어온 요청은 성공·실패와 관계없이 센다. 거절된 요청은 세지 않는다.
// - 비밀번호 실패: 최근 5분 5회째 실패 시점부터 5분 차단. 올바른 비밀번호는 횟수를 늘리지도 지우지도 않는다.
// - 차단 중에는 비밀번호를 비교하지 않고, 차단 시각도 늘리지 않는다. 두 제한이 겹치면 더 긴 대기 시간을 준다.
// 서버도 메모리 기준이라 재시작하면 초기화된다. 목은 DB(sessionStorage)에 둔다.
const STEP_UP_MINUTE = 60 * 1000;
const STEP_UP_BLOCK = 300 * 1000;
function stepUpState(db, user, now) {
  const s = ((db.stepUp ||= {})[user] ||= { requests: [], failures: [], blockedUntil: 0 });
  s.requests = s.requests.filter((t) => t > now - STEP_UP_MINUTE);
  s.failures = s.failures.filter((t) => t > now - STEP_UP_BLOCK);
  return s;
}
function stepUpRemaining(s, now, request) {
  let end = s.blockedUntil;
  if (request && s.requests.length >= 30) end = Math.max(end, s.requests[0] + STEP_UP_MINUTE);
  return end > now ? Math.max(1, Math.ceil((end - now) / 1000)) : 0;
}
const stepUpLimited = (seconds) => fail(429, 'RATE_LIMITED', '잠시 후 다시 시도해 주세요.', undefined, { 'Retry-After': String(seconds) });
function stepUpRequest(db, user) {
  const now = Date.now();
  const s = stepUpState(db, user, now);
  const wait = stepUpRemaining(s, now, true);
  if (wait > 0) stepUpLimited(wait);
  s.requests.push(now);
}
function stepUpVerify(db, user, password) {
  const now = Date.now();
  const s = stepUpState(db, user, now);
  const wait = stepUpRemaining(s, now, false);
  if (wait > 0) stepUpLimited(Math.max(wait, stepUpRemaining(s, now, true)));
  const u = db.users[user];
  if (str(password) && new TextEncoder().encode(password).length <= 72 && password === u.password) return;
  s.failures.push(now);
  if (s.failures.length >= 5) {
    s.blockedUntil = now + STEP_UP_BLOCK;
    stepUpLimited(Math.max(300, stepUpRemaining(s, now, true)));
  }
  fail(401, 'REAUTHENTICATION_FAILED', '비밀번호가 올바르지 않습니다.');
}

function stepUp(ctx) {
  const { db, user, body } = ctx;
  check({
    password: blank(body.password) || tooLong(body.password, 64),
    pin: optPattern(body.pin, /^\d{4}$/),
    purpose: blank(body.purpose) || !/^(TRANSFER|ACCOUNT_PIN|DEBIT_SETTING|TRANSFER_LIMITS)$/.test(body.purpose),
    targetId: !str(body.targetId) || !UUID_ANY_RE.test(body.targetId),
  });
  stepUpRequest(db, user);
  const u = db.users[user];
  if (body.purpose === 'TRANSFER') {
    const p = db.previews[body.targetId];
    if (!p || p.username !== user) fail(404, 'TRANSFER_NOT_FOUND', '이체 정보가 없거나 접근할 수 없습니다.');
    previewUsable(p);
    stepUpVerify(db, user, body.password);
    const source = db.accounts[p.sourceId];
    debitAllowed(source);
    verifyPin(source, body.pin);
    const token = secret();
    db.transferActions[token] = { username: user, previewId: body.targetId, expiresAt: p.expiresAt, securityVersion: source.securityVersion, consumed: false };
    return json(200, { actionToken: token, expiresAt: isoAt(p.expiresAt), authenticationMethod: 'PASSWORD_AND_ACCOUNT_PIN' });
  }
  const changes = parseIntent(body.purpose, body.changes);
  if (body.purpose === 'TRANSFER_LIMITS') {
    if (u.customerId !== body.targetId) fail(404, 'NOT_FOUND', '설정 대상을 확인해 주세요.');
    checkLimitChange(u, changes);
  } else {
    const a = ownedAccount(db, user, body.targetId);
    checking(a);
    if (changes.version !== a.settingsVersion) versionConflict();
  }
  stepUpVerify(db, user, body.password);
  const token = secret();
  const expiresAt = Date.now() + GRANT_SEC * 1000;
  db.settingActions[token] = { username: user, purpose: body.purpose, targetId: body.targetId, payloadHash: intentHash(body.purpose, changes), expiresAt, consumed: false };
  return json(200, { actionToken: token, expiresAt: isoAt(expiresAt), authenticationMethod: 'PASSWORD_RECHECK' });
}

function settingGrant(db, user, token, purpose, targetId, changes) {
  const g = str(token) && Object.hasOwn(db.settingActions, token) ? db.settingActions[token] : null;
  if (!g || g.consumed || g.username !== user || g.purpose !== purpose || g.targetId !== targetId
    || g.payloadHash !== intentHash(purpose, changes) || g.expiresAt <= Date.now()) {
    fail(403, 'ACTION_TOKEN_INVALID', '변경 내용에 대한 비밀번호 재확인이 필요합니다.');
  }
  return g;
}

function setDebit({ db, user, params, body }) {
  check({ actionToken: blank(body.actionToken), changes: !body.changes || typeof body.changes !== 'object' });
  const a = ownedAccount(db, user, params[0]);
  const changes = parseIntent('DEBIT_SETTING', body.changes);
  checking(a);
  if (changes.version !== a.settingsVersion) versionConflict();
  const g = settingGrant(db, user, body.actionToken, 'DEBIT_SETTING', params[0], changes);
  a.debitEnabled = changes.enabled;
  a.settingsVersion += 1;
  a.securityVersion += 1;
  g.consumed = true;
  return json(200, settingsView(params[0], a));
}

function changePin({ db, user, params, body }) {
  check({ actionToken: blank(body.actionToken), changes: !body.changes || typeof body.changes !== 'object', currentPin: optPattern(body.currentPin, /^\d{4}$/) });
  const a = ownedAccount(db, user, params[0]);
  const changes = parseIntent('ACCOUNT_PIN', body.changes);
  checking(a);
  if (changes.version !== a.settingsVersion) versionConflict();
  const g = settingGrant(db, user, body.actionToken, 'ACCOUNT_PIN', params[0], changes);
  pinPolicy(changes.newPin, db.users[user].phone);
  if (a.pin) verifyPin(a, body.currentPin);
  a.pin = changes.newPin;
  a.pinFailures = 0;
  a.settingsVersion += 1;
  a.securityVersion += 1;
  g.consumed = true;
  return json(200, settingsView(params[0], a));
}

function resetPin({ db, user, params, body }) {
  check({
    contactGrant: tooLong(body.contactGrant, 128),
    currentPassword: blank(body.currentPassword) || tooLong(body.currentPassword, 64),
    newPin: blank(body.newPin) || !/^\d{4}$/.test(body.newPin),
    recoveryCode: tooLong(body.recoveryCode, 128),
  });
  const u = db.users[user];
  reauth(u, body.currentPassword);
  if ((body.recoveryCode == null) === (body.contactGrant == null)) recoveryInvalid();
  let proof = null;
  if (body.recoveryCode != null) {
    const c = db.recoveryCodes[body.recoveryCode];
    if (!c || c.consumed || c.username !== user) recoveryInvalid();
  } else {
    proof = contactGrant(db, body.contactGrant, 'PROFILE', user);
    if (proof.contact !== u.phone) recoveryInvalid();
  }
  const a = ownedAccount(db, user, params[0]);
  checking(a);
  pinPolicy(body.newPin, u.phone);
  a.pin = body.newPin;
  a.pinFailures = 0;
  a.settingsVersion += 1;
  a.securityVersion += 1;
  if (proof) proof.consumed = true;
  revokeAll(db, user);
  return empty();
}

function limitsView(db, username) {
  const u = db.users[username];
  const usedToday = used(db, username);
  const remaining = BigInt(u.daily) - usedToday;
  return {
    customerId: u.customerId, perTransfer: money(BigInt(u.perTransfer)), daily: money(BigInt(u.daily)), usedToday: money(usedToday),
    remainingDaily: money(remaining > 0n ? remaining : 0n), date: today(), version: u.limitVersion,
  };
}
const getLimits = ({ db, user }) => json(200, limitsView(db, user));

function updateLimits({ db, user, body }) {
  check({ actionToken: blank(body.actionToken), changes: !body.changes || typeof body.changes !== 'object' });
  const u = db.users[user];
  const changes = parseIntent('TRANSFER_LIMITS', body.changes);
  checkLimitChange(u, changes);
  const g = settingGrant(db, user, body.actionToken, 'TRANSFER_LIMITS', u.customerId, changes);
  u.perTransfer = String(cents(changes.perTransfer));
  u.daily = String(cents(changes.daily));
  u.limitVersion += 1;
  g.consumed = true;
  return json(200, limitsView(db, user));
}

// ---- 자주 쓰는 계좌 (BeneficiaryService) ----

const beneficiaryView = (id, b) => ({ id, bankCode: b.bankCode, accountNumber: b.accountNumber, alias: b.alias, createdAt: b.createdAt, version: b.version });
function ownedBeneficiary(db, user, id) {
  if (!UUID_ANY_RE.test(id)) invalid();
  const b = db.beneficiaries[id];
  if (!b || b.username !== user) fail(404, 'BENEFICIARY_NOT_FOUND', '등록 계좌가 없거나 접근할 수 없습니다.');
  return b;
}

function listBeneficiaries({ db, user }) {
  const items = Object.entries(db.beneficiaries).filter(([, b]) => b.username === user)
    .sort(([, a], [, b]) => a.seq - b.seq).map(([id, b]) => beneficiaryView(id, b));
  return json(200, { items });
}

function addBeneficiary({ db, user, body }) {
  check({
    accountNumber: blank(body.accountNumber) || !/^\d{10,20}$/.test(body.accountNumber),
    alias: tooLong(body.alias, 50),
    bankCode: blank(body.bankCode) || body.bankCode !== 'LOCAL',
  });
  const mine = Object.values(db.beneficiaries).filter((b) => b.username === user);
  if (mine.some((b) => b.accountNumber === body.accountNumber)) fail(409, 'BENEFICIARY_EXISTS', '이미 등록한 계좌입니다.');
  if (mine.length >= 100) fail(409, 'BENEFICIARY_LIMIT', '최대 100개까지 등록할 수 있습니다.');
  const found = accountByNumber(db, body.accountNumber);
  if (!found) fail(404, 'ACCOUNT_NOT_FOUND', '수취 계좌를 확인해 주세요.');
  if (found[1].status !== 'ACTIVE' || found[1].currency !== 'KRW') fail(409, 'ACCOUNT_UNAVAILABLE', '수취할 수 없는 계좌입니다.');
  const alias = body.alias == null ? null : aliasOf(body.alias);
  const id = uuid();
  db.beneficiaries[id] = { username: user, bankCode: 'LOCAL', accountNumber: body.accountNumber, alias, createdAt: nowIso(), version: 0, seq: ++db.seq };
  return json(201, beneficiaryView(id, db.beneficiaries[id]));
}

function updateBeneficiary({ db, user, params, body }) {
  check({ alias: tooLong(body.alias, 50), version: !Number.isInteger(body.version) || body.version < 0 });
  const b = ownedBeneficiary(db, user, params[0]);
  if (body.version !== b.version) versionConflict();
  b.alias = body.alias == null ? null : aliasOf(body.alias);
  b.version += 1;
  return json(200, beneficiaryView(params[0], b));
}

function deleteBeneficiary({ db, user, params, query }) {
  if (!query.has('version') || !/^\d+$/.test(query.get('version'))) invalid();
  const b = ownedBeneficiary(db, user, params[0]);
  if (Number(query.get('version')) !== b.version) versionConflict();
  delete db.beneficiaries[params[0]];
  return empty();
}

// ---- 이체 (TransferService, TransferEngine) ----

function targetAccount(db, number) {
  const found = accountByNumber(db, number);
  if (!found) fail(404, 'ACCOUNT_NOT_FOUND', '수취 계좌를 확인해 주세요.');
  if (found[1].status !== 'ACTIVE' || found[1].currency !== 'KRW') fail(409, 'ACCOUNT_UNAVAILABLE', '수취할 수 없는 계좌입니다.');
  return found;
}

function engineCheck(from, to, fromId, toId, amount) {
  checking(from);
  checking(to);
  if (fromId === toId) fail(400, 'SAME_ACCOUNT', '출금 계좌와 입금 계좌가 같습니다.');
  if (amount <= 0n) invalid('amount', '금액 범위를 확인해 주세요.');
  if (from.status !== 'ACTIVE' || to.status !== 'ACTIVE') fail(409, 'ACCOUNT_UNAVAILABLE', '거래할 수 없는 계좌입니다.');
  if (BigInt(from.balance) < amount) fail(409, 'INSUFFICIENT_BALANCE', '잔액이 부족합니다.');
  if (BigInt(to.balance) + amount > MAX_BALANCE) fail(409, 'BALANCE_LIMIT_EXCEEDED', '입금 계좌의 잔액 상한을 초과합니다.');
}

function validateReceiver({ db, body }) {
  check({ accountNumber: blank(body.accountNumber) || !/^\d{10,20}$/.test(body.accountNumber), bankCode: blank(body.bankCode) || body.bankCode !== 'LOCAL' });
  const [, a] = targetAccount(db, body.accountNumber);
  const n = body.accountNumber;
  return json(200, { bankCode: 'LOCAL', maskedAccountNumber: '*'.repeat(n.length - 4) + n.slice(-4), receiverName: maskName(db.users[a.owner].name), nameVerified: false });
}

function previewUsable(p) {
  if (p.resultId) fail(409, 'PREVIEW_ALREADY_USED', '이미 실행한 확인 건입니다.');
  if (p.expiresAt <= Date.now()) fail(409, 'PREVIEW_EXPIRED', '확인 시간이 만료되었습니다. 다시 확인해 주세요.');
}

function createPreview({ db, user, body }) {
  const amountBad = moneyField(body.amount, 'amount');
  check({
    amount: amountBad,
    bankCode: blank(body.bankCode) || body.bankCode !== 'LOCAL',
    fromAccountId: !str(body.fromAccountId) || !UUID_ANY_RE.test(body.fromAccountId),
    memo: tooLong(body.memo, 100),
    toAccountNumber: blank(body.toAccountNumber) || !/^\d{10,20}$/.test(body.toAccountNumber),
  });
  const from = db.accounts[body.fromAccountId];
  if (!from || from.owner !== user) fail(404, 'ACCOUNT_NOT_FOUND', '출금 계좌가 없거나 접근할 수 없습니다.');
  const [toId, to] = targetAccount(db, body.toAccountNumber);
  const amount = cents(body.amount);
  if (body.memo != null && CONTROL_RE.test(body.memo)) invalid('memo', '메모에 제어문자를 사용할 수 없습니다.');
  engineCheck(from, to, body.fromAccountId, toId, amount);
  debitAllowed(from);
  checkLimits(db, user, amount);
  const id = uuid();
  const expiresAt = Date.now() + 300 * 1000;
  const details = {
    fromAccountId: body.fromAccountId, fromAccountNumber: from.number, bankCode: 'LOCAL', toAccountNumber: to.number,
    receiverName: maskName(db.users[to.owner].name), nameVerified: false, memo: body.memo ?? null,
  };
  db.previews[id] = { username: user, sourceId: body.fromAccountId, targetId: toId, amount: String(amount), expiresAt, details, resultId: null };
  return json(201, { previewId: id, details, amount: money(amount), fee: '0.00', currency: 'KRW', expiresAt: isoAt(expiresAt) });
}

const transferView = (id, r) => ({
  transferId: id, status: 'completed', previewId: r.previewId, details: r.details, amount: money(BigInt(r.amount)),
  fee: '0.00', currency: 'KRW', balanceAfter: money(BigInt(r.balanceAfter)), createdAt: r.createdAt,
});

function executeTransfer(ctx) {
  const { db, user, body } = ctx;
  check({ actionToken: blank(body.actionToken) || tooLong(body.actionToken, 128), previewId: !str(body.previewId) || !UUID_ANY_RE.test(body.previewId) });
  return idempotent(ctx, { scope: user, op: 'TRANSFER_V2' }, () => {
    const p = db.previews[body.previewId];
    if (!p || p.username !== user) fail(404, 'TRANSFER_NOT_FOUND', '이체 정보가 없거나 접근할 수 없습니다.');
    previewUsable(p);
    const action = db.transferActions[body.actionToken];
    if (!action || action.username !== user || action.previewId !== body.previewId || action.consumed || action.expiresAt <= Date.now()) {
      fail(403, 'ACTION_TOKEN_INVALID', '이 확인 건에 대한 비밀번호 재확인이 필요합니다.');
    }
    // 실행 시점에 잔액·상태·한도를 다시 검사한다(preview는 잔액을 예약하지 않는다).
    const from = db.accounts[p.sourceId];
    const to = db.accounts[p.targetId];
    const amount = BigInt(p.amount);
    banking(db.users[user]);
    engineCheck(from, to, p.sourceId, p.targetId, amount);
    debitAllowed(from);
    if (action.securityVersion !== from.securityVersion) fail(403, 'ACTION_TOKEN_INVALID', '계좌 보안 설정이 변경되었습니다. 다시 인증해 주세요.');
    consumeLimit(db, user, amount);
    const { transferId, fromBalance } = move(db, p.sourceId, p.targetId, amount);
    db.transferRecords[transferId] = { username: user, previewId: body.previewId, amount: String(amount), balanceAfter: String(fromBalance), createdAt: nowIso(), details: p.details, seq: ++db.seq };
    p.resultId = transferId;
    action.consumed = true;
    return transferView(transferId, db.transferRecords[transferId]);
  });
}

function getTransfer({ db, user, params }) {
  if (!UUID_ANY_RE.test(params[0])) invalid();
  const r = db.transferRecords[params[0]];
  if (!r || r.username !== user) fail(404, 'TRANSFER_NOT_FOUND', '이체 정보가 없거나 접근할 수 없습니다.');
  return json(200, transferView(params[0], r));
}

function listTransfers({ db, user, query }) {
  const r = range(query);
  const scope = `transfers:${db.users[user].customerId}`;
  const cursor = query.get('cursor');
  const pos = cursor ? decodeCursor(cursor, scope, r.from, r.to, 'SENT') : null;
  const time = (x) => Date.parse(x.createdAt);
  const maxSeq = pos ? pos.max : db.seq;
  const rows = Object.entries(db.transferRecords).map(([id, x]) => ({ id, ...x }))
    .filter((x) => x.username === user && time(x) >= r.start && time(x) < r.end && x.seq <= maxSeq);
  const { page, hasNext } = paginate(rows, time, r, pos);
  const last = page[page.length - 1];
  return json(200, {
    items: page.map((x) => transferView(x.id, x)),
    nextCursor: hasNext ? encodeCursor({ scope, from: r.from, to: r.to, type: 'SENT', max: maxSeq, time: time(last), seq: last.seq }) : null,
    hasNext, from: r.from, to: r.to,
  });
}

// ---- 시연용 가상 입금 (demo 프로필 BankService.deposit) ----

function demoDeposit(ctx) {
  const { db, user, body, headers } = ctx;
  if (!headers.get('Idempotency-Key')) invalid(undefined, '요청 경로, 방식과 형식을 확인해 주세요.');
  // 기존 BigDecimal DTO라 숫자·문자열 모두 받는다.
  const text = typeof body.amount === 'number' ? String(body.amount) : body.amount;
  check({ accountNumber: blank(body.accountNumber), amount: !(str(text) && /^\d+(\.\d+)?$/.test(text)) || cents(text) < 1n });
  if ((text.split('.')[1] ?? '').length > 2) invalid('amount', '금액은 소수점 둘째 자리까지만 입력할 수 있습니다.');
  return idempotent(ctx, { scope: user, op: 'DEPOSIT' }, () => {
    const found = accountByNumber(db, body.accountNumber);
    if (!found || found[1].owner !== user) fail(404, 'ACCOUNT_NOT_FOUND', '계좌가 없거나 접근할 수 없습니다.');
    const [id, a] = found;
    checking(a);
    if (a.status !== 'ACTIVE' || a.currency !== 'KRW') fail(409, 'ACCOUNT_UNAVAILABLE', '입금할 수 없는 계좌입니다.');
    const amount = cents(text);
    if (BigInt(a.balance) + amount > MAX_BALANCE) fail(409, 'BALANCE_LIMIT_EXCEEDED', '입금 계좌의 잔액 상한을 초과합니다.');
    a.balance = String(BigInt(a.balance) + amount);
    const depositId = uuid();
    addEntry(db, id, { transferId: depositId, counterparty: 'SIMULATED_CASH_DEPOSIT', amount, createdAt: nowIso() });
    return { depositId, status: 'completed', source: 'simulated_cash' };
  });
}

// ---- 예금·적금 (SavingsService) ----

const savingsProducts = () => json(200, PRODUCTS);

function savingsView(db, id, c) {
  const a = db.accounts[c.accountId];
  return {
    subscriptionId: id, productId: c.productId, accountId: c.accountId, accountNumber: a.number, status: c.status,
    principal: money(BigInt(a.balance)), installment: money(BigInt(c.installment)), openedOn: c.openedOn, maturityOn: c.maturityOn,
    closedOn: c.closedOn, version: c.version, annualRate: c.annualRate, earlyRate: c.earlyRate, termsVersion: c.termsVersion,
    simulation: true, payments: c.payments.map((p) => ({ period: p.period, paidOn: p.paidOn, amount: money(BigInt(p.amount)) })),
  };
}
function ownedSavings(db, user, id) {
  if (!UUID_ANY_RE.test(id)) invalid();
  const c = db.savings[id];
  if (!c || c.username !== user) fail(404, 'SAVINGS_NOT_FOUND', '가입 정보를 찾을 수 없습니다.');
  return c;
}
function savingsAuth(db, username, password) {
  limit(db, `savings-auth:${username}`, 5, 300);
  const u = db.users[username];
  if (new TextEncoder().encode(password).length > 72 || password !== u.password) fail(401, 'REAUTHENTICATION_FAILED', '비밀번호가 올바르지 않습니다.');
}
function funding(db, user, from, amount) {
  checking(from);
  if (from.status !== 'ACTIVE' || from.currency !== 'KRW') conflict('ACCOUNT_UNAVAILABLE');
  debitAllowed(from);
  if (BigInt(from.balance) < amount) conflict('INSUFFICIENT_BALANCE');
  checkLimits(db, user, amount);
}

function listSavings({ db, user }) {
  const items = Object.entries(db.savings).filter(([, c]) => c.username === user)
    .sort(([, a], [, b]) => b.seq - a.seq).map(([id, c]) => savingsView(db, id, c));
  return json(200, { items });
}
const getSavings = ({ db, user, params }) => json(200, savingsView(db, params[0], ownedSavings(db, user, params[0])));

function joinSavings(ctx) {
  const { db, user, body, headers } = ctx;
  const amountBad = moneyField(body.amount, 'amount', /^[1-9]\d{0,7}(\.\d{1,2})?$/);
  check({
    amount: amountBad,
    password: blank(body.password) || tooLong(body.password, 64),
    pin: optPattern(body.pin, /^\d{4}$/),
    productId: blank(body.productId),
    sourceAccountId: !str(body.sourceAccountId) || !UUID_ANY_RE.test(body.sourceAccountId),
    termsVersion: blank(body.termsVersion),
  });
  const u = db.users[user];
  banking(u);
  return idempotent(ctx, { scope: user, op: 'SAVINGS_JOIN' }, () => {
    const product = PRODUCTS.find((p) => p.productId === body.productId);
    if (!product) fail(400, 'PRODUCT_NOT_FOUND', '상품을 확인해 주세요.');
    if (body.termsVersion !== SAVINGS_TERMS) conflict('TERMS_VERSION_MISMATCH');
    const amount = cents(body.amount);
    if (amount < cents(product.minimum) || amount > cents(product.maximum)) conflict('PRODUCT_AMOUNT_INVALID');
    const source = ownedAccount(db, user, body.sourceAccountId);
    funding(db, user, source, amount);
    savingsAuth(db, user, body.password);
    verifyPin(source, body.pin);
    let number;
    do number = `3${randomDigits(15)}`; while (accountByNumber(db, number));
    const holdingId = createAccount(db, user, { number, accountName: product.name, accountType: product.accountType, debitEnabled: false });
    const openedOn = today();
    const id = uuid();
    db.savings[id] = {
      username: user, accountId: holdingId, productId: product.productId, termsVersion: SAVINGS_TERMS, openedOn,
      maturityOn: plusMonths(openedOn, product.months), months: product.months, annualRate: product.annualRate, earlyRate: product.earlyRate,
      installment: String(amount), status: 'ACTIVE', version: 0, closedOn: null, payments: [], seq: ++db.seq,
    };
    consumeLimit(db, user, amount);
    move(db, body.sourceAccountId, holdingId, amount);
    db.savings[id].payments.push({ period: 0, paidOn: openedOn, amount: String(amount) });
    return savingsView(db, id, db.savings[id]);
  });
}

// 가입일 기준 월 회차 (SavingsService.period)
function period(opened, day) {
  const [oy, om] = opened.split('-').map(Number);
  const [dy, dm] = day.split('-').map(Number);
  let p = (dy - oy) * 12 + dm - om;
  if (day < plusMonths(opened, p)) p -= 1;
  return p;
}

function paySavings(ctx) {
  const { db, user, params, body, headers } = ctx;
  check({
    password: blank(body.password) || tooLong(body.password, 64),
    pin: optPattern(body.pin, /^\d{4}$/),
    sourceAccountId: !str(body.sourceAccountId) || !UUID_ANY_RE.test(body.sourceAccountId),
    version: !Number.isInteger(body.version) || body.version < 0,
  });
  const u = db.users[user];
  banking(u);
  return idempotent(ctx, { scope: user, op: 'SAVINGS_PAY' }, () => {
    const c = ownedSavings(db, user, params[0]);
    if (c.status !== 'ACTIVE') conflict('SAVINGS_CLOSED');
    if (body.version !== c.version) versionConflict();
    if (c.productId !== 'MOCK-SAVINGS-12') conflict('PAYMENT_NOT_SUPPORTED');
    const day = today();
    const p = period(c.openedOn, day);
    if (p < 0 || p >= c.months || day >= c.maturityOn) conflict('PAYMENT_PERIOD_CLOSED');
    if (c.payments.some((x) => x.period === p)) conflict('PERIOD_ALREADY_PAID');
    const source = ownedAccount(db, user, body.sourceAccountId);
    const holding = db.accounts[c.accountId];
    if (holding.status !== 'ACTIVE') conflict('ACCOUNT_UNAVAILABLE');
    const amount = BigInt(c.installment);
    funding(db, user, source, amount);
    savingsAuth(db, user, body.password);
    verifyPin(source, body.pin);
    consumeLimit(db, user, amount);
    move(db, body.sourceAccountId, c.accountId, amount);
    c.payments.push({ period: p, paidOn: day, amount: String(amount) });
    c.version += 1;
    return savingsView(db, params[0], c);
  });
}

// 단리·실제 일수/365, 소수 둘째 자리 버림 (SavingsService.interest)
function interestOf(payments, end, rate) {
  const rateMicro = cents(rate) * 10000n; // "0.030000" → 30000 (백만분율)
  let total = 0n;
  for (const p of payments) total += BigInt(p.amount) * rateMicro * BigInt(Math.max(0, daysBetween(p.paidOn, end)));
  return total / (365n * 1000000n);
}

function quoteOf(db, user, id, c, targetId) {
  if (c.status !== 'ACTIVE') conflict('SAVINGS_CLOSED');
  const target = ownedAccount(db, user, targetId);
  checking(target);
  if (target.status !== 'ACTIVE' || target.currency !== 'KRW') conflict('ACCOUNT_UNAVAILABLE');
  const holding = db.accounts[c.accountId];
  if (holding.status !== 'ACTIVE') conflict('ACCOUNT_UNAVAILABLE');
  const day = today();
  const mature = day >= c.maturityOn;
  const interest = interestOf(c.payments, mature ? c.maturityOn : day, mature ? c.annualRate : c.earlyRate);
  const principal = BigInt(holding.balance);
  const total = principal + interest;
  if (BigInt(target.balance) + total > MAX_BALANCE) conflict('BALANCE_LIMIT_EXCEEDED');
  const q = {
    subscriptionId: id, targetAccountId: targetId, version: c.version, quoteDate: day, principal: money(principal),
    interest: money(interest), tax: '0.00', total: money(total), closureType: mature ? 'MATURE' : 'EARLY', simulation: true,
  };
  q.quoteToken = btoa(unescape(encodeURIComponent(`${user}|${JSON.stringify(q)}`))).slice(-43);
  return { q, interest, principal };
}

function closureQuote({ db, user, params, query }) {
  const c = ownedSavings(db, user, params[0]);
  if (!UUID_ANY_RE.test(query.get('targetAccountId') ?? '')) invalid();
  return json(200, quoteOf(db, user, params[0], c, query.get('targetAccountId')).q);
}

function closeSavings(ctx) {
  const { db, user, params, body, headers } = ctx;
  check({
    password: blank(body.password) || tooLong(body.password, 64),
    quoteDate: !str(body.quoteDate) || !DAY_RE.test(body.quoteDate),
    quoteToken: blank(body.quoteToken),
    targetAccountId: !str(body.targetAccountId) || !UUID_ANY_RE.test(body.targetAccountId),
    version: !Number.isInteger(body.version) || body.version < 0,
  });
  const u = db.users[user];
  banking(u);
  return idempotent(ctx, { scope: user, op: 'SAVINGS_CLOSE' }, () => {
    const c = ownedSavings(db, user, params[0]);
    if (c.status !== 'ACTIVE') conflict('SAVINGS_CLOSED');
    if (body.version !== c.version) versionConflict();
    const { q, interest, principal } = quoteOf(db, user, params[0], c, body.targetAccountId);
    if (body.quoteDate !== q.quoteDate || body.quoteToken !== q.quoteToken) conflict('QUOTE_STALE');
    savingsAuth(db, user, body.password);
    move(db, c.accountId, body.targetAccountId, principal);
    if (interest > 0n) {
      const target = db.accounts[body.targetAccountId];
      target.balance = String(BigInt(target.balance) + interest);
      addEntry(db, body.targetAccountId, { transferId: uuid(), counterparty: 'SIMULATED_SAVINGS_INTEREST', amount: interest, createdAt: nowIso() });
    }
    const holding = db.accounts[c.accountId];
    holding.status = 'CLOSED';
    holding.securityVersion += 1;
    holding.settingsVersion += 1;
    c.status = 'CLOSED';
    c.closedOn = q.quoteDate;
    c.version += 1;
    const { quoteToken, ...result } = q;
    return { ...result, status: 'CLOSED', version: c.version };
  });
}

const health = () => json(200, { status: 'ok' });

// ---------------------------------------------------------------------------
// 라우팅
// [메서드, 경로, 핸들러, 인증, JSON 본문 필요]  인증: true | false | 'optional'(본문의 purpose로 판단)

const ID = '([^/]+)';
const V2 = '^\\/api\\/v2';
const r = (path) => new RegExp(`${V2}${path}$`);
const ROUTES = [
  ['GET', r('\\/terms'), terms, false, false],
  ['POST', r('\\/contact-challenges'), startChallenge, 'optional', true],
  ['POST', r(`\\/contact-challenges\\/${ID}\\/verify`), verifyChallenge, 'optional', true],
  ['POST', r('\\/auth\\/register'), register, false, true],
  ['POST', r('\\/auth\\/login'), login, false, true],
  ['POST', r('\\/auth\\/logout'), logout, true, false],
  ['GET', r('\\/auth\\/session'), sessionStatus, 'status', false],
  ['POST', r('\\/auth\\/session\\/extend'), sessionStatus, true, false],
  ['GET', r('\\/auth\\/me'), getMe, true, false],
  ['POST', r('\\/auth\\/step-up'), stepUp, true, true],
  ['POST', r('\\/recovery\\/verifications'), verifyRecovery, false, true],
  ['POST', r('\\/recovery\\/password'), resetPassword, false, true],
  ['POST', r('\\/recovery\\/login-unlock'), unlockLogin, false, true],
  ['PUT', r('\\/me\\/profile'), updateProfile, true, true],
  ['PUT', r('\\/me\\/contact'), applyContact, true, true],
  ['PUT', r('\\/me\\/password'), changePassword, true, true],
  ['GET', r('\\/me\\/terms'), myTerms, true, false],
  ['GET', r('\\/me\\/recovery-codes'), recoveryCodeStatus, true, false],
  ['POST', r('\\/me\\/recovery-codes'), issueRecoveryCodes, true, true],
  ['GET', r('\\/me\\/transfer-limits'), getLimits, true, false],
  ['PUT', r('\\/me\\/transfer-limits'), updateLimits, true, true],
  ['GET', r('\\/accounts'), listAccounts, true, false],
  ['POST', r('\\/accounts'), openAccount, true, true],
  ['GET', r(`\\/accounts\\/${ID}`), getAccount, true, false],
  ['GET', r(`\\/accounts\\/${ID}\\/transactions`), transactions, true, false],
  ['GET', r(`\\/accounts\\/${ID}\\/preferences`), getPreferences, true, false],
  ['PATCH', r(`\\/accounts\\/${ID}\\/preferences`), updatePreferences, true, true],
  ['PUT', r(`\\/accounts\\/${ID}\\/debit-setting`), setDebit, true, true],
  ['PUT', r(`\\/accounts\\/${ID}\\/pin`), changePin, true, true],
  ['POST', r(`\\/accounts\\/${ID}\\/pin\\/reset`), resetPin, true, true],
  ['GET', r('\\/beneficiaries'), listBeneficiaries, true, false],
  ['POST', r('\\/beneficiaries'), addBeneficiary, true, true],
  ['PATCH', r(`\\/beneficiaries\\/${ID}`), updateBeneficiary, true, true],
  ['DELETE', r(`\\/beneficiaries\\/${ID}`), deleteBeneficiary, true, false],
  ['POST', r('\\/transfers\\/receiver-validation'), validateReceiver, true, true],
  ['POST', r('\\/transfers\\/previews'), createPreview, true, true],
  ['POST', r('\\/transfers'), executeTransfer, true, true],
  ['GET', r('\\/transfers'), listTransfers, true, false],
  ['GET', r(`\\/transfers\\/${ID}`), getTransfer, true, false],
  ['POST', r('\\/demo\\/deposits'), demoDeposit, true, true],
  ['GET', r('\\/savings-products'), savingsProducts, false, false],
  ['GET', r('\\/savings'), listSavings, true, false],
  ['POST', r('\\/savings'), joinSavings, true, true],
  ['GET', r(`\\/savings\\/${ID}`), getSavings, true, false],
  ['POST', r(`\\/savings\\/${ID}\\/payments`), paySavings, true, true],
  ['GET', r(`\\/savings\\/${ID}\\/closure-quote`), closureQuote, true, false],
  ['POST', r(`\\/savings\\/${ID}\\/closure`), closeSavings, true, true],
  ['GET', /^\/health$/, health, false, false],
];

// 멱등 요청 경로 (commit-then-502 대상)
const IDEMPOTENT_PATHS = /^\/api\/v2\/(auth\/register|accounts|demo\/deposits|transfers|savings|savings\/[^/]+\/(payments|closure))$/;

// 토큰 검사: 절대 만료(8시간), 유휴 만료(마지막 인증 요청 후 10분), 사용자 보안 버전. touch면 활동 시각을 갱신한다.
function authenticate(db, headers, touch) {
  const m = /^Bearer (\S+)$/.exec(headers.get('Authorization') || '');
  if (!m) return null;
  const t = Object.hasOwn(db.tokens, m[1]) ? db.tokens[m[1]] : null;
  const now = Date.now();
  if (!t || t.expiresAt <= now || t.lastActivityAt + IDLE_SEC * 1000 <= now || !db.users[t.username]
    || t.authVersion !== db.users[t.username].authVersion) return null;
  if (touch) t.lastActivityAt = now;
  return { user: t.username, token: m[1] };
}

const unauthorized = () => fail(401, 'UNAUTHORIZED', '로그인이 필요하거나 토큰이 만료되었습니다.');
function requireUser(ctx) {
  if (!ctx.user) {
    const found = authenticate(ctx.db, ctx.headers, true);
    if (!found) unauthorized();
    ctx.user = found.user;
    ctx.token = found.token;
  }
  return ctx.user;
}

function route(method, url, headers, rawBody, ctx) {
  const path = url.pathname;
  // 구 경로는 서버가 차단한다(익명 401 / 인증 403). 미구현 기능으로 오해하지 않도록 같은 응답을 낸다.
  if (/^\/api\/(auth|accounts)(\/|$)|^\/api\/(transfers|deposits)$/.test(path)) {
    return authenticate(loadDb(), headers, false) ? fail(403, 'FORBIDDEN', '접근 권한이 없습니다.') : unauthorized();
  }
  const matched = ROUTES.filter(([, re]) => re.test(path));
  if (!matched.length) {
    // 서버는 인증이 필요한 미지원 경로에 익명 401, 인증 사용자 404를 준다.
    return authenticate(loadDb(), headers, false) ? fail(404, 'NOT_FOUND', '요청 경로, 방식과 형식을 확인해 주세요.') : unauthorized();
  }
  const found = matched.find(([m]) => m === method);
  if (!found) fail(405, 'METHOD_NOT_ALLOWED', '요청 경로, 방식과 형식을 확인해 주세요.');
  const [, re, handler, auth, needsBody] = found;

  const db = loadDb();
  Object.assign(ctx, { db, headers, rawBody, path, query: url.searchParams, user: null, token: null });
  if (auth === true || auth === 'status') {
    const who = authenticate(db, headers, auth === true); // 세션 상태 조회는 활동으로 치지 않는다
    if (!who) unauthorized();
    ctx.user = who.user;
    ctx.token = who.token;
  }
  try {
    ctx.params = re.exec(path).slice(1).map(decodeURIComponent);
  } catch {
    invalid(undefined, '요청 경로, 방식과 형식을 확인해 주세요.');
  }
  ctx.body = {};
  if (needsBody) {
    if (!(headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
      fail(415, 'UNSUPPORTED_MEDIA_TYPE', '요청 경로, 방식과 형식을 확인해 주세요.');
    }
    try {
      ctx.body = JSON.parse(rawBody);
    } catch {
      fail(400, 'INVALID_INPUT', 'JSON 본문과 필드 자료형을 확인해 주세요.');
    }
    if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) fail(400, 'INVALID_INPUT', 'JSON 본문과 필드 자료형을 확인해 주세요.');
  }
  return handler(ctx);
}

// ---------------------------------------------------------------------------
// 진입점

export async function handle(request) {
  const url = new URL(request.url);
  const { method, headers, signal } = request;
  const rawBody = await request.text();
  const label = `${method} ${url.pathname}`;

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
      return json(500, { code: 'INTERNAL_ERROR', message: '요청 처리 중 오류가 발생했습니다.' });
    }
  }

  await delay(150 + Math.random() * 300, signal);

  const ctx = { committed: false };
  let response;
  try {
    response = route(method, url, headers, rawBody, ctx);
  } catch (err) {
    if (!(err instanceof Fail)) throw err;
    const body = { code: err.code, message: err.message };
    if (err.field) body.field = err.field; // 특정할 수 없으면 키 자체를 생략한다
    response = json(err.status, body);
    for (const [name, value] of Object.entries(err.headers ?? {})) response.headers.set(name, value);
  }
  // 실패 응답에도 저장한다: 로그인 실패·PIN 오류·인증번호 오류 횟수는 서버도 남긴다. 그 밖의 핸들러는 검사 후에만 상태를 바꾼다.
  if (ctx.db) saveDb(ctx.db);

  // 커밋까지 끝낸 뒤 프록시가 502를 돌려준 상황. 새로 처리된 멱등 요청에만 적용한다.
  if (method === 'POST' && IDEMPOTENT_PATHS.test(url.pathname) && ctx.committed && getFault() === 'commit-then-502') {
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

// 개발 패널(장애 주입·DB 리셋·모의 수신함)은 목 모드에서만 붙는다.
if (typeof document !== 'undefined') {
  import('./devpanel.js').then((m) => m.mount());
}
