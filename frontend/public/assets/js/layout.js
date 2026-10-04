// 모든 페이지가 불러오는 공통 스크립트: 로그인 필요 페이지 보호, 헤더 로그인 상태·세션 남은 시간, 모바일 메뉴, 깡통 조회 결과.
// GNB·푸터 HTML 자체는 site/build.mjs가 미리 생성해 두므로 여기서 만들지 않는다.

import { getToken, getDisplayName, hasDisplayName, setDisplayName, clearSession, redirectToLogin, setNotice, takeNotice } from './session.js';
import { ROUTES } from './routes.js';
import { formatRemaining } from './format.js';

// 로그인 필요 여부는 사이트맵의 auth 값이 <meta name="pb-auth">로 들어온다.
// 화면 이동만 막을 뿐이다. HTML은 누구나 받을 수 있고, 데이터는 서버의 401·404가 보호한다.
if (document.querySelector('meta[name="pb-auth"]')?.content === 'required' && !getToken()) {
  redirectToLogin();
} else {
  init();
}

function init() {
  const member = Boolean(getToken());
  document.querySelectorAll('[data-when]').forEach((node) => {
    node.hidden = (node.dataset.when === 'member') !== member;
  });
  showDisplayName();
  if (member && !hasDisplayName()) loadDisplayName();
  document.querySelectorAll('[data-logout]').forEach((button) => button.addEventListener('click', () => logout(button)));

  showNotice();
  if (member) startSessionTimer();

  // 좁은 화면의 전체메뉴 버튼
  const toggle = document.querySelector('.gnb-toggle');
  const header = document.querySelector('.site-header');
  toggle?.addEventListener('click', () => {
    const open = header.classList.toggle('gnb-open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  // 깡통 조회·검색 폼: 조건을 넣고 제출하면(쿼리가 있으면) 결과 없음 문구로 바꾼다.
  if (location.search) {
    document.querySelectorAll('[data-stub-result]').forEach((node) => { node.textContent = node.dataset.stubResult; });
  }
}

// 헤더 "○○님"과 메인 인사말. 본명이 없으면 아이디를 보여 준다.
function showDisplayName() {
  document.querySelectorAll('[data-username]').forEach((node) => { node.textContent = getDisplayName(); });
}

// 로그인 직후 이름 조회가 실패했거나 이 기능 전에 로그인한 세션이면 한 번 더 받아 온다.
async function loadDisplayName() {
  try {
    const api = await loadApi();
    setDisplayName((await api.getMe())?.name);
    showDisplayName();
  } catch (err) {
    if (!err.handled) console.warn('[layout] 이름을 불러오지 못해 아이디로 표시합니다.', err.code ?? err.kind ?? err);
  }
}

function showNotice() {
  const text = takeNotice();
  const main = document.getElementById('main');
  if (!text || !main) return;
  main.prepend(Object.assign(document.createElement('p'), { className: 'notice warning', role: 'status', textContent: text }));
}

// api.js는 목 모듈까지 불러오므로 로그인 상태일 때만 가져온다.
// 함수 선언문이어야 한다: 파일 위쪽의 init()이 이 줄보다 먼저 실행되므로 const 화살표 함수면 TDZ 오류가 난다.
function loadApi() {
  return import('./api.js').then((m) => m.api);
}

// 서버 로그아웃 → 브라우저 토큰 정리. 응답을 못 받으면 토큰은 지우되 서버 폐기는 확인되지 않았다고 알린다.
async function logout(button) {
  button.disabled = true;
  try {
    const api = await loadApi();
    await api.logout(); // 204
  } catch (err) {
    if (!err.handled) setNotice('로그아웃 요청의 서버 처리 결과를 확인하지 못했습니다. 이 브라우저의 로그인 정보는 지웠습니다.');
  }
  clearSession();
  location.replace(ROUTES.home);
}

// ---------------------------------------------------------------------------
// 세션 남은 시간 (작업 요청서 A2)
// - 표시 기준은 서버의 idleExpiresAt이다. 브라우저가 임의로 시간을 늘리지 않는다.
// - GET /auth/session은 활동으로 치지 않으므로 이것만 조회한다. 남은 시간 갱신을 위해 업무 API를 폴링하지 않는다.
// - 다른 인증 요청이 성공하면(pb-activity) 서버가 시간을 늘렸으므로 다시 읽는다. 탭으로 돌아올 때도 다시 읽는다.
// - 0초가 되면 서버에 한 번 확인한다. 만료됐으면 401 UNAUTHORIZED → api.js가 로그인 화면으로 보낸다.

const WARN_MS = 60 * 1000;

function startSessionTimer() {
  const label = document.querySelector('[data-session-timer]');
  const extendButton = document.querySelector('[data-session-extend]');
  if (!label) return;
  let expiresAt = null; // ms
  let checking = false;
  let debounce = null;
  let stopped = false;
  let lastCheck = 0;

  async function refresh(call = 'sessionStatus') {
    if (checking || stopped) return;
    checking = true;
    lastCheck = Date.now();
    try {
      const api = await loadApi();
      const status = await api[call]();
      const idle = Date.parse(status.idleExpiresAt);
      expiresAt = Number.isFinite(idle) ? idle : null;
    } catch (err) {
      if (!err.handled) console.warn('[session] 세션 상태를 확인하지 못했습니다.', err.code ?? err.kind ?? err);
    } finally {
      checking = false;
      render();
    }
  }

  function render() {
    if (expiresAt === null) {
      label.textContent = '-';
      return;
    }
    const left = expiresAt - Date.now();
    label.textContent = `자동 로그아웃 ${formatRemaining(left)}`;
    label.classList.toggle('warn', left <= WARN_MS);
    if (left <= 0 && Date.now() - lastCheck > 5000) refresh(); // 확인 실패 시 매초 재요청하지 않는다
  }

  setInterval(() => { if (!stopped) render(); }, 1000);
  window.addEventListener('pb-activity', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => refresh(), 800);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  window.addEventListener('pb-session-ended', () => { stopped = true; });
  extendButton?.addEventListener('click', async () => {
    extendButton.disabled = true;
    await refresh('extendSession');
    extendButton.disabled = false;
  });
  refresh();
}
