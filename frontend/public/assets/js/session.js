// 토큰 저장·만료 확인·페이지 보호.
// 서버 세션은 두 가지로 끝난다(작업 요청서 A2): 발급 후 8시간(절대 만료), 마지막 인증 요청 후 10분(유휴 만료).
// 브라우저는 절대 만료만 알고 있다. 유휴 만료는 서버가 판단하며 layout.js가 GET /api/v2/auth/session으로 표시만 한다.
// 서버 로그아웃(POST /api/v2/auth/logout)은 api.js를 써야 하므로 layout.js에 있다.

import { ROUTES } from './routes.js';

const TOKEN_KEY = 'token';
const EXPIRES_AT_KEY = 'expiresAt';
const USERNAME_KEY = 'username'; // 로그인 폼 입력값(아이디). 비밀번호 규칙 검사·재인증 대기 구분에 쓴다.
const DISPLAY_NAME_KEY = 'displayName'; // 화면 인사말용 본명. 로그인 직후 GET /auth/me의 name
const NOTICE_KEY = 'pb-notice';

export function saveSession(token, expiresIn, username) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + expiresIn * 1000));
  sessionStorage.setItem(USERNAME_KEY, username);
}

export function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXPIRES_AT_KEY);
  sessionStorage.removeItem(USERNAME_KEY);
  sessionStorage.removeItem(DISPLAY_NAME_KEY);
}

// 유효한 토큰을 돌려준다. 없거나 절대 만료가 지났으면 세션을 지우고 null.
export function getToken() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expiresAt = Number(sessionStorage.getItem(EXPIRES_AT_KEY));
  if (!token || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    if (token) clearSession();
    return null;
  }
  return token;
}

export function getUsername() {
  return sessionStorage.getItem(USERNAME_KEY) || '';
}

// 헤더·메인 인사말에 보여 줄 이름. 이름이 없는 계정(가입 전 데이터 등)은 아이디로 대신한다.
export function setDisplayName(name) {
  if (typeof name === 'string' && name.trim()) sessionStorage.setItem(DISPLAY_NAME_KEY, name.trim());
}
export const hasDisplayName = () => Boolean(sessionStorage.getItem(DISPLAY_NAME_KEY));
export function getDisplayName() {
  return sessionStorage.getItem(DISPLAY_NAME_KEY) || getUsername();
}

// 다음 페이지에 한 번만 보여 줄 안내(예: 서버 로그아웃 확인 실패). 비밀값을 넣지 않는다.
export function setNotice(text) {
  sessionStorage.setItem(NOTICE_KEY, text);
}

export function takeNotice() {
  const text = sessionStorage.getItem(NOTICE_KEY);
  sessionStorage.removeItem(NOTICE_KEY);
  return text;
}

// ---------------------------------------------------------------------------
// 로그인 후 복귀 경로 (?next=)

const stripSlash = (path) => path.replace(/\/+$/, '') || '/';

// next 값을 같은 오리진의 경로로만 허용한다(오픈 리다이렉트 방지). 그 밖의 값은 홈으로 바꾼다.
// "//evil.com", "/\evil.com", "https://evil.com"은 URL 해석 결과 오리진이 달라져 걸러진다.
export function safeNext(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return ROUTES.home;
  let url;
  try {
    url = new URL(raw, location.origin);
  } catch {
    return ROUTES.home;
  }
  if (url.origin !== location.origin) return ROUTES.home;
  if (stripSlash(url.pathname) === stripSlash(ROUTES.login)) return ROUTES.home; // 로그인 페이지로 되돌아가는 반복 방지
  return url.pathname + url.search + url.hash;
}

export function loginHref(next) {
  return next ? `${ROUTES.login}?next=${encodeURIComponent(next)}` : ROUTES.login;
}

// 현재 페이지를 next로 붙여 로그인 페이지로 보낸다.
export function redirectToLogin() {
  location.replace(loginHref(location.pathname + location.search));
}

// 보호 페이지 진입 시 호출. 토큰이 없으면 로그인 페이지로 보내고 false.
export function requireAuth() {
  if (getToken()) return true;
  redirectToLogin();
  return false;
}

// 비밀번호 변경·재설정, PIN 재설정 성공 뒤: 서버가 이미 모든 세션을 폐기했다.
// 다른 업무 요청을 보내지 않고 브라우저 토큰만 지운 뒤 헤더를 비회원 상태로 바꾼다.
export function endSessionLocally() {
  clearSession();
  document.querySelectorAll('[data-when]').forEach((n) => { n.hidden = n.dataset.when === 'member'; });
  window.dispatchEvent(new CustomEvent('pb-session-ended'));
}
