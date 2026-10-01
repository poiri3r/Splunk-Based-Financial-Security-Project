// 시연용 가상 입금. 동작은 기존 내 계좌 화면의 입금 부분과 같다.
// 결과가 불확실하면 입력을 바꾸지 않는 한 같은 거래(같은 멱등키)로 다시 보낸다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { parseAmount } from '../validate.js';
import { formatAmount } from '../format.js';
import { clearErrors, showFieldError, showApiError, setBusy, el, transactionsLink } from '../ui.js';

if (requireAuth()) init();

function init() {
  const section = document.getElementById('deposit-section');
  const loading = document.getElementById('deposit-loading');
  const noAccounts = document.getElementById('no-accounts');
  const form = document.getElementById('deposit-form');
  const select = form.accountNumber;
  const balanceHint = document.getElementById('deposit-balance');
  const submit = form.querySelector('button[type="submit"]');
  const uncertainBox = document.getElementById('deposit-uncertain');
  const retryButton = document.getElementById('deposit-retry');
  const historyLink = document.getElementById('deposit-history');
  const resultBox = document.getElementById('deposit-result');

  const balances = new Map(); // 계좌번호 → 서버가 준 잔액
  let pendingTx = null; // 결과가 불확실한 입금. 입력을 바꾸기 전까지 같은 키로 재시도한다.

  function renderBalance() {
    const balance = balances.get(select.value);
    balanceHint.textContent = balance === undefined ? '' : `현재 잔액 ${formatAmount(balance)}`;
  }

  function discardPending() {
    pendingTx = null;
    uncertainBox.hidden = true;
  }
  select.addEventListener('change', () => { discardPending(); renderBalance(); });
  form.amount.addEventListener('input', discardPending);

  async function refreshBalance(number) {
    try {
      const res = await api.getBalance(number);
      balances.set(number, res.balance);
      renderBalance();
    } catch (err) {
      showApiError(form, err);
    }
  }

  async function submitDeposit(tx, number) {
    clearErrors(form);
    resultBox.hidden = true;
    uncertainBox.hidden = true;
    setBusy(submit, true);
    retryButton.disabled = true;
    try {
      const res = await tx.submit();
      pendingTx = null;
      resultBox.textContent = `가상 입금이 완료되었습니다. (거래 ID: ${res.depositId})`;
      resultBox.hidden = false;
      form.amount.value = '';
      await refreshBalance(number);
    } catch (err) {
      if (err.uncertain) {
        pendingTx = tx;
        historyLink.href = transactionsLink(number);
        uncertainBox.hidden = false;
      } else {
        pendingTx = null;
        showApiError(form, err);
      }
    } finally {
      setBusy(submit, false);
      retryButton.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(form);
    const number = select.value;
    if (!number) return showFieldError(form, 'accountNumber', '입금할 계좌를 선택해 주세요.');
    const { value, error } = parseAmount(form.amount.value);
    if (error) return showFieldError(form, 'amount', error);

    // 입력이 그대로인 결과 미확인 거래가 있으면 새 키를 만들지 않고 그 거래를 다시 보낸다.
    const tx = pendingTx || api.newDeposit(number, value);
    submitDeposit(tx, number);
  });

  retryButton.addEventListener('click', () => {
    if (pendingTx) submitDeposit(pendingTx, select.value);
  });

  async function load() {
    let accounts;
    try {
      accounts = await api.listAccounts();
    } catch (err) {
      showApiError(section, err);
      return;
    } finally {
      loading.hidden = true;
    }
    if (accounts.length === 0) {
      noAccounts.hidden = false;
      return;
    }
    accounts.forEach((a) => balances.set(a.number, a.balance));
    select.replaceChildren(...accounts.map((a) => el('option', { value: a.number, textContent: a.number })));
    const preset = new URLSearchParams(location.search).get('account');
    if (preset && balances.has(preset)) select.value = preset;
    renderBalance();
    form.hidden = false;
  }

  load();
}
