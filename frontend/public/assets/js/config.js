// 앱 전역 상수. 실제 백엔드로 전환할 때는 USE_MOCK만 false로 바꾼다.

// 상대 경로로만 호출한다. 로컬은 http-server --proxy, 운영은 Nginx가 /api를 백엔드로 넘긴다.
export const API_BASE = '';

// true: public/mock/mock.js가 응답한다. false: fetch로 실제 서버에 요청한다.
export const USE_MOCK = true;

// 요청 1회 타임아웃(ms). fetch에는 기본 타임아웃이 없다. (잠정)
export const TIMEOUT_MS = 10000;

// 입금·송금 자동 재시도 간격(ms). 길이가 재시도 횟수다 (총 시도 = 길이 + 1).
export const IDEMPOTENT_RETRY_DELAYS_MS = [1000, 2000];

// GET 자동 재시도 간격(ms). 1회만 재시도한다.
export const GET_RETRY_DELAYS_MS = [1000];
