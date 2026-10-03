// 예금·적금 가입내역 (작업 요청서 R5). GET /api/v2/savings → { items }, 상품명은 productId로 상품 목록과 연결한다.
// principal은 예적금 계좌의 현재 잔액이다(최초 가입 원금이 아님). 가입 응답에 출금 계좌는 없으므로 추정하지 않는다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { formatAmount, formatRate, formatDate, ACCOUNT_TYPE_LABELS } from '../format.js';
import { clearErrors, showApiError, el, savingsDetailLink, transactionsLink } from '../ui.js';
import { statusLabel, kstToday, productNameOf } from '../savings.js';

if (requireAuth()) init();

function init() {
  const section = document.getElementById('sub-section');
  const table = document.getElementById('sub-table');
  const loading = document.getElementById('sub-loading');
  const empty = document.getElementById('sub-empty');

  async function load() {
    clearErrors(section);
    try {
      const [{ items }, products] = await Promise.all([api.listSavings(), api.savingsProducts()]);
      const today = kstToday();
      document.getElementById('sub-body').replaceChildren(...items.map((s) => {
        const product = products.find((p) => p.productId === s.productId);
        return el('tr', {}, [
          el('td', { textContent: productNameOf(products, s.productId) }),
          el('td', { textContent: ACCOUNT_TYPE_LABELS[product?.accountType] ?? '-' }),
          el('td', { className: 'num plain', textContent: formatAmount(s.principal) }),
          el('td', { className: 'num plain', textContent: formatAmount(s.installment) }),
          el('td', { className: 'num plain', textContent: formatRate(s.annualRate) }),
          el('td', { textContent: formatDate(s.openedOn) }),
          el('td', { textContent: formatDate(s.maturityOn) }),
          el('td', {}, [el('a', { className: 'mono', href: transactionsLink(s.accountId), textContent: s.accountNumber })]),
          el('td', { textContent: statusLabel(s, today) }),
          el('td', {}, [el('a', { href: savingsDetailLink(s.subscriptionId), textContent: '상세' })]),
        ]);
      }));
      document.getElementById('sub-count').textContent = `총 ${items.length}건`;
      table.hidden = items.length === 0;
      empty.hidden = items.length !== 0;
    } catch (err) {
      showApiError(section, err);
    } finally {
      loading.hidden = true;
    }
  }

  load();
}
