// 목 모드 전용 개발 패널: 장애 주입 선택, 목 DB 리셋, 모의 수신함(인증번호), 세션 유휴 만료, 목 요청 로그.
// mock.js가 목 모드에서만 불러오므로 USE_MOCK = false이면 화면에 나타나지 않는다.

import { FAULTS, getFault, setFault, resetDb, expireSessions, getInbox } from './mock.js';
import { clearSession } from '../assets/js/session.js';

const COLLAPSED_KEY = 'mock-panel-collapsed';
const MAX_LOG = 8;

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export function mount() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
    return;
  }
  if (document.querySelector('.mock-panel')) return;

  const select = el('select', { id: 'mock-fault' },
    FAULTS.map(([value, label]) => el('option', { value, textContent: `${value} — ${label}` })));
  select.value = getFault();
  select.addEventListener('change', () => setFault(select.value));
  window.addEventListener('mock-fault-change', () => { select.value = getFault(); });

  const resetButton = el('button', { type: 'button', className: 'button small danger', textContent: '목 DB 리셋' });
  resetButton.addEventListener('click', () => {
    if (!confirm('목 DB를 초기 상태로 되돌리고 로그아웃합니다.')) return;
    resetDb();
    clearSession();
    location.href = '/login/';
  });

  // 모의 수신함: 실서버에서는 시연 담당자가 서버 전용 키로 POST /api/v2/demo/inbox를 조회해 번호를 전달한다(추가 협의 C1 A안).
  const inboxList = el('ol', { className: 'mock-log' });
  const renderInbox = () => {
    inboxList.replaceChildren(...getInbox().map((m) => el('li', { textContent: `${m.code}  ${m.contact} (${m.purpose})` })));
  };
  window.addEventListener('mock-inbox', renderInbox);
  renderInbox();

  const expireButton = el('button', { type: 'button', className: 'button small', textContent: '세션 유휴 만료시키기' });
  expireButton.addEventListener('click', () => {
    expireSessions();
    expireButton.textContent = '만료됨 — 다음 요청에서 로그아웃';
  });

  const logList = el('ol', { className: 'mock-log' });
  window.addEventListener('mock-log', (e) => {
    logList.prepend(el('li', { textContent: `${new Date().toLocaleTimeString('ko-KR')} ${e.detail}` }));
    while (logList.children.length > MAX_LOG) logList.lastChild.remove();
  });

  const body = el('div', { className: 'mock-panel-body' }, [
    el('label', { htmlFor: 'mock-fault', textContent: '장애 주입 (1회 적용 후 none으로 복귀)' }),
    select,
    el('p', { className: 'mock-hint', textContent: 'alice / Demo!Alice7392 · 김시연 · 2000000000000001 · PIN 4826' }),
    el('p', { className: 'mock-hint', textContent: 'bob / Demo!Bob5837 · 이시연 · 2000000000000002 · PIN 7391' }),
    el('p', { className: 'mock-hint', textContent: '모의 수신함 (최근 인증번호)' }),
    inboxList,
    el('div', { className: 'actions' }, [resetButton, expireButton]),
    logList,
  ]);

  const toggle = el('button', { type: 'button', className: 'mock-panel-toggle', textContent: 'MOCK' });
  const panel = el('aside', { className: 'mock-panel' }, [toggle, body]);
  const setCollapsed = (collapsed) => {
    panel.classList.toggle('collapsed', collapsed);
    sessionStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  };
  toggle.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));
  setCollapsed(sessionStorage.getItem(COLLAPSED_KEY) === '1');

  document.body.append(panel);
}
