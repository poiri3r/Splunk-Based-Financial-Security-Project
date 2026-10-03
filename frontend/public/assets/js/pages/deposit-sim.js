// 시연용 가상 입금 (demo 프로필 전용 POST /api/v2/demo/deposits). 본인 정상 입출금 계좌에만 들어간다.
// 요청은 계좌번호(number)로 보내고, 잔액 재조회는 계좌 UUID로 한다.
// 결과가 불확실하면 같은 거래(같은 멱등키)로만 다시 보낸다. 그동안 계좌·금액 입력은 잠근다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { parseAmount } from '../validate.js';
import { formatAmount } from '../format.js';
import {
  clearErrors, showFieldError, showApiError, setBusy, el, guardUnload, setDisabled,
  transactionsLink, accountLabel, isDebitCandidate,
} from '../ui.js';

if (requireAuth()) init();

function init() {
  const section = document.getElementById('deposit-section');
  const loading = document.getElementById('deposit-loading');
  const noAccounts = document.getElementById('no-accounts');
  const form = document.getElementById('deposit-form');
  const select = form.accountId;
  const balanceHint = document.getElementById('deposit-balance');
  const submit = form.querySelector('button[type="submit"]');
  const uncertainBox = document.getElementById('deposit-uncertain');
  const retryButton = document.getElementById('deposit-retry');
  const historyLink = document.getElementById('deposit-history');
  const resultBox = document.getElementById('deposit-result');

  let accounts = []; // 서버 계좌 상세
  let pendingTx = null; // 결과가 불확실한 입금

  const current = () => accounts.find((a) => a.accountId === select.value);

  function renderBalance() {
    const a = current();
    balanceHint.textContent = a ? `현재 잔액 ${formatAmount(a.balance)}` : '';
  }
  select.addEventListener('change', renderBalance);

  function setPending(tx) {
    pendingTx = tx;
    const pending = Boolean(tx);
    setDisabled([select, form.amount, submit], pending);
    uncertainBox.hidden = !pending;
    guardUnload(pending);
  }

  async function refreshBalance(accountId) {
    try {
      const detail = await api.getAccount(accountId);
      accounts = accounts.map((a) => (a.accountId === accountId ? detail : a));
      renderBalance();
    } catch (err) {
      // 이미 성공한 입금이다. 잔액 재조회 실패를 입금 실패로 바꾸지 않는다.
      if (!err.handled) balanceHint.textContent = '잔액을 다시 불러오지 못했습니다. 새로고침해 주세요.';
    }
  }

  async function submitDeposit(tx, accountId) {
    clearErrors(form);
    resultBox.hidden = true;
    setBusy(submit, true);
    retryButton.disabled = true;
    try {
      const res = await tx.submit(); // { depositId, status, source }
      setPending(null);
      resultBox.textContent = `가상 입금이 완료되었습니다. (거래 ID: ${res.depositId})`;
      resultBox.hidden = false;
      form.amount.value = '';
      await refreshBalance(accountId);
    } catch (err) {
      if (err.uncertain) {
        historyLink.href = transactionsLink(accountId);
        setPending(tx);
      } else {
        setPending(null);
        showApiError(form, err, {
          NOT_FOUND: { message: '가상 입금 API가 없습니다. 백엔드를 demo 프로필로 실행했는지 확인해 주세요.' },
        });
      }
    } finally {
      setBusy(submit, false);
      submit.disabled = Boolean(pendingTx);
      retryButton.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pendingTx) return;
    clearErrors(form);
    const account = current();
    if (!account) return showFieldError(form, 'accountId', '입금할 계좌를 선택해 주세요.');
    const { value, error } = parseAmount(form.amount.value);
    if (error) return showFieldError(form, 'amount', error);
    submitDeposit(api.newDemoDeposit(account.number, value), account.accountId);
  });

  retryButton.addEventListener('click', () => {
    if (pendingTx) submitDeposit(pendingTx, select.value);
  });

  async function load() {
    try {
      accounts = (await api.listAccounts()).items.filter(isDebitCandidate);
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
    select.replaceChildren(...accounts.map((a) => el('option', { value: a.accountId, textContent: accountLabel(a) })));
    const preset = new URLSearchParams(location.search).get('account');
    if (preset && accounts.some((a) => a.accountId === preset)) select.value = preset;
    renderBalance();
    form.hidden = false;
  }

  load();
}
