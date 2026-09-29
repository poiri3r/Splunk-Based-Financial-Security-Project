// 목 모드 전용 개발 패널: 장애 주입 선택, 목 DB 리셋, 목 요청 로그.
// mock.js가 목 모드에서만 불러오므로 USE_MOCK = false이면 화면에 나타나지 않는다.

import { FAULTS, getFault, setFault, resetDb } from './mock.js';
import { clearSession } from '../js/session.js';

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
    location.href = 'login.html';
  });

  const logList = el('ol', { className: 'mock-log' });
  window.addEventListener('mock-log', (e) => {
    logList.prepend(el('li', { textContent: `${new Date().toLocaleTimeString('ko-KR')} ${e.detail}` }));
    while (logList.children.length > MAX_LOG) logList.lastChild.remove();
  });

  const body = el('div', { className: 'mock-panel-body' }, [
    el('label', { htmlFor: 'mock-fault', textContent: '장애 주입 (1회 적용 후 none으로 복귀)' }),
    select,
    el('p', { className: 'mock-hint', textContent: 'demo 계정: alice / DemoPass123! · bob / DemoPass456!' }),
    resetButton,
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
