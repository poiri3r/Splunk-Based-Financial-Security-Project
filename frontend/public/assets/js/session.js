// 토큰 저장·만료 확인·로그아웃·페이지 보호.
// 로그아웃 API는 없다. 브라우저의 토큰만 지우며, 서버 토큰은 발급 후 8시간까지 유효하다.

import { ROUTES } from './routes.js';

const TOKEN_KEY = 'token';
const EXPIRES_AT_KEY = 'expiresAt';
const USERNAME_KEY = 'username'; // 화면 표시용. 서버가 준 값이 아니라 로그인 폼 입력값이다.

export function saveSession(token, expiresIn, username) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + expiresIn * 1000));
  sessionStorage.setItem(USERNAME_KEY, username);
}

export function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXPIRES_AT_KEY);
  sessionStorage.removeItem(USERNAME_KEY);
}

// 유효한 토큰을 돌려준다. 없거나 만료됐으면 세션을 지우고 null.
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

export function logout() {
  clearSession();
  location.replace(ROUTES.home);
}
