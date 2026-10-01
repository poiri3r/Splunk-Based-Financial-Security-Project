// 거래내역조회. 계좌는 ?account= 로 받는다. 없으면 내 첫 번째 계좌를 조회한다.
// 계좌 선택 폼은 GET으로 제출되어 같은 페이지를 ?account=와 함께 다시 연다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import {
  formatAmount, formatSignedAmount, formatDateTime, formatCounterparty, transactionKind,
} from '../format.js';
import { clearErrors, showFormError, showApiError, el, transferLink } from '../ui.js';

if (requireAuth()) init();

function init() {
  const section = document.getElementById('tx-section');
  const select = document.getElementById('tx-select');
  const table = document.getElementById('tx-table');
  const tbody = document.getElementById('tx-body');
  const empty = document.getElementById('tx-empty');
  const noAccounts = document.getElementById('tx-no-accounts');
  const loading = document.getElementById('tx-loading');
  const balanceNode = document.getElementById('tx-balance');
  const refreshButton = document.getElementById('tx-refresh');
  const transferButton = document.getElementById('tx-transfer');

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

  async function load(number) {
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

  async function start() {
    const requested = new URLSearchParams(location.search).get('account');

    // 계좌 선택 목록. 실패해도 요청된 계좌는 조회를 시도한다.
    let accounts = [];
    try {
      accounts = await api.listAccounts();
    } catch (err) {
      showApiError(section, err);
      if (err.handled || requested === null) return;
    }
    select.replaceChildren(...accounts.map((a) => el('option', { value: a.number, textContent: a.number })));

    if (requested === null && accounts.length === 0) {
      noAccounts.hidden = false;
      return;
    }
    const number = requested ?? accounts[0].number;
    if (!/^\d+$/.test(number)) {
      // 검증을 통과하지 못하면 요청하지 않는다.
      showFormError(section, '계좌번호가 올바르지 않습니다. 계좌를 다시 선택해 주세요.');
      return;
    }
    // 내 목록에 없는 계좌도 그대로 조회한다(서버가 404로 판단한다).
    if (!accounts.some((a) => a.number === number)) select.append(el('option', { value: number, textContent: number }));
    select.value = number;
    document.getElementById('tx-account').textContent = number;
    transferButton.href = transferLink(number);
    refreshButton.addEventListener('click', () => load(number));
    await load(number);
  }

  start();
}
