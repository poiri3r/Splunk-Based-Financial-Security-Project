// 전체계좌조회: 보유 계좌와 잔액 목록. 계좌 개설은 /products/open, 가상 입금은 /deposit-sim으로 분리했다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { formatAmount } from '../format.js';
import { clearErrors, showApiError, el, transferLink, transactionsLink, depositLink } from '../ui.js';

if (requireAuth()) init();

function init() {
  const section = document.getElementById('accounts-section');
  const list = document.getElementById('account-list');
  const loading = document.getElementById('accounts-loading');
  const empty = document.getElementById('accounts-empty');
  const count = document.getElementById('accounts-count');
  const refreshButton = document.getElementById('refresh-accounts');

  function renderAccounts(accounts) {
    list.replaceChildren(...accounts.map((account) => el('li', { className: 'account' }, [
      el('div', { className: 'account-info' }, [
        el('span', { className: 'account-type', textContent: '입출금' }),
        el('span', { className: 'account-number', textContent: account.number }),
        el('span', { className: 'balance', textContent: formatAmount(account.balance) }),
      ]),
      el('div', { className: 'actions' }, [
        el('a', { className: 'button small', href: transactionsLink(account.number), textContent: '거래내역' }),
        el('a', { className: 'button small', href: depositLink(account.number), textContent: '가상 입금' }),
        el('a', { className: 'button small primary', href: transferLink(account.number), textContent: '이체' }),
      ]),
    ])));
    count.textContent = `총 ${accounts.length}개`;
    empty.hidden = accounts.length !== 0;
  }

  async function loadAccounts() {
    clearErrors(section);
    loading.hidden = false;
    refreshButton.disabled = true;
    try {
      renderAccounts(await api.listAccounts());
    } catch (err) {
      showApiError(section, err);
    } finally {
      loading.hidden = true;
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener('click', loadAccounts);
  loadAccounts();
}
