// 접속 기록: 최근 로그인 시도(성공·실패). 서버만 알 수 있는 정보라 API가 필요하다(가안 10.02 합의 사항 3-6).
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { formatDateTime } from '../format.js';
import { clearErrors, showApiError, el } from '../ui.js';

if (requireAuth()) init();

function init() {
  const section = document.getElementById('history-section');
  const table = document.getElementById('history-table');
  const empty = document.getElementById('history-empty');
  const loading = document.getElementById('history-loading');
  const refresh = document.getElementById('history-refresh');

  async function load() {
    clearErrors(section);
    loading.hidden = false;
    refresh.disabled = true;
    try {
      const list = await api.loginHistory();
      document.getElementById('history-body').replaceChildren(...list.map((h) => el('tr', {}, [
        el('td', { textContent: formatDateTime(h.at) }),
        el('td', {}, [el('span', { className: `tag ${h.success ? 'in' : 'out'}`, textContent: h.success ? '성공' : '실패' })]),
        el('td', { className: 'mono', textContent: h.ip }),
        el('td', { className: 'ua', textContent: h.userAgent, title: h.userAgent }),
      ])));
      table.hidden = list.length === 0;
      empty.hidden = list.length !== 0;
    } catch (err) {
      showApiError(section, err);
    } finally {
      loading.hidden = true;
      refresh.disabled = false;
    }
  }

  refresh.addEventListener('click', load);
  load();
}
