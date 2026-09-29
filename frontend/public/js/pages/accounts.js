import { api, isUncertain } from '../api.js';
import { requireAuth } from '../session.js';
import { parseAmount } from '../validate.js';
import { formatAmount } from '../format.js';
import {
  clearErrors, showFieldError, showFormError, showApiError, setBusy, setupHeader, el,
  transferLink, transactionsLink,
} from '../ui.js';

if (requireAuth()) {
  setupHeader();
  init();
}

function init() {
  const section = document.getElementById('accounts-section');
  const list = document.getElementById('account-list');
  const loading = document.getElementById('accounts-loading');
  const empty = document.getElementById('accounts-empty');
  const openButton = document.getElementById('open-account');
  const refreshButton = document.getElementById('refresh-accounts');

  const depositSection = document.getElementById('deposit-section');
  const depositForm = document.getElementById('deposit-form');
  const depositSelect = depositForm.accountNumber;
  const depositSubmit = depositForm.querySelector('button[type="submit"]');
  const uncertainBox = document.getElementById('deposit-uncertain');
  const retryButton = document.getElementById('deposit-retry');
  const historyLink = document.getElementById('deposit-history');
  const resultBox = document.getElementById('deposit-result');

  const balanceNodes = new Map(); // 계좌번호 → 잔액 표시 요소

  // ---- 계좌 목록 ----------------------------------------------------------

  function renderAccounts(accounts) {
    balanceNodes.clear();
    list.replaceChildren(...accounts.map((account) => {
      const balance = el('span', { className: 'balance', textContent: formatAmount(account.balance) });
      balanceNodes.set(account.number, balance);
      return el('li', { className: 'account' }, [
        el('div', { className: 'account-info' }, [
          el('span', { className: 'account-number', textContent: account.number }),
          balance,
        ]),
        el('div', { className: 'actions' }, [
          el('a', { className: 'button small', href: transferLink(account.number), textContent: '송금' }),
          el('a', { className: 'button small', href: transactionsLink(account.number), textContent: '거래내역' }),
        ]),
      ]);
    }));

    const isEmpty = accounts.length === 0;
    empty.hidden = !isEmpty;
    openButton.classList.toggle('primary', isEmpty);
    openButton.classList.toggle('attention', isEmpty);

    // 입금 계좌 목록은 선택값을 유지하며 갱신한다.
    const previous = depositSelect.value;
    depositSelect.replaceChildren(...accounts.map((a) => el('option', { value: a.number, textContent: a.number })));
    if (accounts.some((a) => a.number === previous)) depositSelect.value = previous;
    else discardPending(); // 결과 미확인 거래의 계좌가 사라졌으면 그 거래를 버린다
    depositSection.hidden = isEmpty;
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

  // 계좌 개설은 멱등하지 않으므로 자동 재시도하지 않는다.
  openButton.addEventListener('click', async () => {
    clearErrors(section);
    setBusy(openButton, true, '개설 중…');
    try {
      await api.openAccount(); // 201
    } catch (err) {
      if (isUncertain(err)) {
        showFormError(section, '계좌 개설 결과를 확인하지 못했습니다. 목록을 새로고침해 개설 여부를 확인한 뒤 다시 시도해 주세요.');
      } else {
        showApiError(section, err);
      }
      setBusy(openButton, false);
      return;
    }
    setBusy(openButton, false);
    await loadAccounts();
  });

  // ---- 시연용 가상 입금 ----------------------------------------------------

  let pendingTx = null; // 결과가 불확실한 입금. 입력을 바꾸기 전까지 같은 키로 재시도한다.

  function discardPending() {
    pendingTx = null;
    uncertainBox.hidden = true;
  }
  depositSelect.addEventListener('change', discardPending);
  depositForm.amount.addEventListener('input', discardPending);

  async function refreshBalance(number) {
    const node = balanceNodes.get(number);
    if (!node) return;
    try {
      const res = await api.getBalance(number);
      node.textContent = formatAmount(res.balance);
    } catch (err) {
      showApiError(section, err);
    }
  }

  async function submitDeposit(tx, number) {
    clearErrors(depositForm);
    resultBox.hidden = true;
    uncertainBox.hidden = true;
    setBusy(depositSubmit, true);
    retryButton.disabled = true;
    try {
      const res = await tx.submit();
      pendingTx = null;
      resultBox.textContent = `가상 입금이 완료되었습니다. (거래 ID: ${res.depositId})`;
      resultBox.hidden = false;
      depositForm.amount.value = '';
      await refreshBalance(number);
    } catch (err) {
      if (err.uncertain) {
        pendingTx = tx;
        historyLink.href = transactionsLink(number);
        uncertainBox.hidden = false;
      } else {
        pendingTx = null;
        showApiError(depositForm, err);
      }
    } finally {
      setBusy(depositSubmit, false);
      retryButton.disabled = false;
    }
  }

  depositForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(depositForm);
    const number = depositSelect.value;
    if (!number) return showFieldError(depositForm, 'accountNumber', '입금할 계좌를 선택해 주세요.');
    const { value, error } = parseAmount(depositForm.amount.value);
    if (error) return showFieldError(depositForm, 'amount', error);

    // 입력이 그대로인 결과 미확인 거래가 있으면 새 키를 만들지 않고 그 거래를 다시 보낸다.
    const tx = pendingTx || api.newDeposit(number, value);
    submitDeposit(tx, number);
  });

  retryButton.addEventListener('click', () => {
    if (pendingTx) submitDeposit(pendingTx, depositSelect.value);
  });

  loadAccounts();
}
