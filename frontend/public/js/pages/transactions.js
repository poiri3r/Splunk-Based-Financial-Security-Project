import { api } from '../api.js';
import { requireAuth } from '../session.js';
import {
  formatAmount, formatSignedAmount, formatDateTime, formatCounterparty, transactionKind,
} from '../format.js';
import { clearErrors, showFormError, showApiError, setupHeader, el, transferLink } from '../ui.js';

if (requireAuth()) {
  setupHeader();
  init();
}

function init() {
  const section = document.getElementById('tx-section');
  const table = document.getElementById('tx-table');
  const tbody = document.getElementById('tx-body');
  const empty = document.getElementById('tx-empty');
  const loading = document.getElementById('tx-loading');
  const balanceNode = document.getElementById('tx-balance');
  const refreshButton = document.getElementById('tx-refresh');

  const number = new URLSearchParams(location.search).get('account') || '';
  if (!/^\d+$/.test(number)) {
    // 검증을 통과하지 못하면 요청하지 않는다.
    showFormError(section, '계좌번호가 올바르지 않습니다. 내 계좌 화면에서 다시 선택해 주세요.');
    return;
  }

  document.getElementById('tx-account').textContent = number;
  const transferButton = document.getElementById('tx-transfer');
  transferButton.href = transferLink(number);

  function renderRows(transactions) {
    // 응답은 이미 최신순이다. 다시 정렬하지 않는다.
    tbody.replaceChildren(...transactions.map((t) => {
      const kind = transactionKind(t.amount);
      return el('tr', {}, [
        el('td', { textContent: formatDateTime(t.createdAt) }),
        el('td', {}, [el('span', { className: `tag ${t.amount > 0 ? 'in' : 'out'}`, textContent: kind })]),
        el('td', { textContent: formatCounterparty(t.counterparty) }),
        el('td', { className: `num ${t.amount > 0 ? 'in' : 'out'}`, textContent: formatSignedAmount(t.amount) }),
        el('td', { className: 'mono small', textContent: t.transferId, title: t.transferId }),
      ]);
    }));
    table.hidden = transactions.length === 0;
    empty.hidden = transactions.length !== 0;
  }

  async function load() {
    clearErrors(section);
    loading.hidden = false;
    refreshButton.disabled = true;
    try {
      const [balance, transactions] = await Promise.all([api.getBalance(number), api.getTransactions(number)]);
      balanceNode.textContent = `잔액 ${formatAmount(balance.balance)}`;
      renderRows(transactions);
      refreshButton.hidden = false;
      transferButton.hidden = false;
    } catch (err) {
      table.hidden = true;
      empty.hidden = true;
      balanceNode.textContent = '';
      showApiError(section, err);
      refreshButton.hidden = err.code === 'ACCOUNT_NOT_FOUND';
    } finally {
      loading.hidden = true;
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener('click', load);
  load();
}
