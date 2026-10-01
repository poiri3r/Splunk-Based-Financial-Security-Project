// 예금·적금 가입내역. API는 백엔드 가안(GET /api/subscriptions)이며 현재는 목 서버만 응답한다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { formatAmount, formatDateTime } from '../format.js';
import { clearErrors, showApiError, el, transactionsLink } from '../ui.js';
import { PRODUCT_TYPES } from '../data/products.js';

const STATUS_LABELS = { ACTIVE: '정상', MATURED: '만기', CLOSED: '해지' };

if (requireAuth()) init();

function init() {
  const section = document.getElementById('sub-section');
  const table = document.getElementById('sub-table');
  const loading = document.getElementById('sub-loading');
  const empty = document.getElementById('sub-empty');

  async function load() {
    clearErrors(section);
    try {
      const list = await api.listSubscriptions();
      document.getElementById('sub-body').replaceChildren(...list.map((s) => el('tr', {}, [
        el('td', { textContent: s.productName }),
        el('td', { textContent: PRODUCT_TYPES[s.type]?.label ?? s.type }),
        el('td', { className: 'num', textContent: formatAmount(s.amount) }),
        el('td', { textContent: `${s.termMonths}개월` }),
        el('td', { className: 'num', textContent: `${Number(s.rate).toFixed(2)}%` }),
        el('td', { textContent: formatDateTime(s.createdAt) }),
        el('td', { textContent: s.maturityDate }),
        el('td', {}, [el('a', { href: transactionsLink(s.fromAccount), textContent: s.fromAccount })]),
        el('td', { textContent: STATUS_LABELS[s.status] ?? s.status }),
      ])));
      document.getElementById('sub-count').textContent = `총 ${list.length}건`;
      table.hidden = list.length === 0;
      empty.hidden = list.length !== 0;
    } catch (err) {
      showApiError(section, err);
    } finally {
      loading.hidden = true;
    }
  }

  load();
}
