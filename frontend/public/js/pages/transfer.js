import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { parseAmount, validateAccountNumber } from '../validate.js';
import { formatAmount } from '../format.js';
import {
  clearErrors, showFieldError, showFormError, showApiError, setBusy, setupHeader, el,
  transactionsLink, MSG_ACCOUNT_NOT_FOUND,
} from '../ui.js';

if (requireAuth()) {
  setupHeader();
  init();
}

function init() {
  const steps = Object.fromEntries(
    [...document.querySelectorAll('[data-step]')].map((node) => [node.dataset.step, node]),
  );
  const stepLabels = document.querySelectorAll('[data-step-label]');
  const form = document.getElementById('transfer-form');
  const fromSelect = form.fromAccount;
  const fromBalance = document.getElementById('from-balance');
  const nextButton = form.querySelector('button[type="submit"]');
  const sendButton = document.getElementById('send-transfer');
  const editButton = document.getElementById('edit-transfer');
  const uncertainBox = document.getElementById('transfer-uncertain');

  let myAccounts = []; // [{ number, balance }] — 서버가 준 값만 보관한다
  let tx = null; // 확인 단계에서 만든 거래 한 건(멱등키 + 고정 본문)
  let draft = null; // 확인 중인 입력값 { fromAccount, toAccount, amount }

  function showStep(name) {
    for (const [key, node] of Object.entries(steps)) node.hidden = key !== name;
    stepLabels.forEach((li) => li.classList.toggle('active', li.dataset.stepLabel === name));
  }

  function renderFromBalance() {
    const account = myAccounts.find((a) => a.number === fromSelect.value);
    fromBalance.textContent = account ? `잔액 ${formatAmount(account.balance)}` : '';
  }

  // 잔액은 계산하지 않고 항상 조회 API 값으로 바꾼다.
  async function refreshBalance(number) {
    const res = await api.getBalance(number);
    const account = myAccounts.find((a) => a.number === number);
    if (account) account.balance = res.balance;
    return res.balance;
  }

  // ---- 1. 입력 ------------------------------------------------------------

  fromSelect.addEventListener('change', renderFromBalance);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(form);
    const fromAccount = fromSelect.value;
    const toAccount = form.toAccount.value.trim();

    if (!fromAccount) return showFieldError(form, 'fromAccount', '출금 계좌를 선택해 주세요.');
    const toError = validateAccountNumber(toAccount);
    if (toError) return showFieldError(form, 'toAccount', toError);
    if (toAccount === fromAccount) {
      return showFieldError(form, 'toAccount', '출금 계좌와 같은 계좌로는 송금할 수 없습니다.');
    }
    const { value: amount, error } = parseAmount(form.amount.value);
    if (error) return showFieldError(form, 'amount', error);

    // 확인 단계로 넘어가는 시점에 키를 만들고 본문을 고정한다.
    draft = { fromAccount, toAccount, amount };
    tx = api.newTransfer(fromAccount, toAccount, amount);

    document.getElementById('confirm-from').textContent = fromAccount;
    const isMine = myAccounts.some((a) => a.number === toAccount);
    document.getElementById('confirm-to').textContent = isMine ? `${toAccount} (내 계좌)` : toAccount;
    document.getElementById('confirm-amount').textContent = formatAmount(amount);
    clearErrors(steps.confirm);
    uncertainBox.hidden = true;
    sendButton.textContent = '송금하기';
    showStep('confirm');
    sendButton.focus();
  });

  // ---- 2. 확인 ------------------------------------------------------------

  // 수정하면 기존 거래(키)를 버린다. 다시 확인하면 새 키가 만들어진다.
  editButton.addEventListener('click', () => {
    tx = null;
    showStep('input');
  });

  // 송금 실패(4xx)를 입력 단계에 표시한다. 키는 이미 폐기됐다.
  async function showRejected(err) {
    tx = null;
    showStep('input');
    clearErrors(form);
    switch (err.code) {
      case 'SAME_ACCOUNT':
        showFieldError(form, 'toAccount', err.message);
        return;
      case 'ACCOUNT_NOT_FOUND':
        // 어느 계좌 문제인지 알 수 없으므로 통합 안내한다(field 제공 여부 미정).
        showFormError(form, MSG_ACCOUNT_NOT_FOUND);
        return;
      case 'INSUFFICIENT_BALANCE':
        showFormError(form, err.message);
        try {
          await refreshBalance(draft.fromAccount);
          renderFromBalance();
        } catch (e) {
          showApiError(form, e);
        }
        return;
      default:
        showApiError(form, err);
    }
  }

  sendButton.addEventListener('click', async () => {
    if (!tx) return;
    clearErrors(steps.confirm);
    uncertainBox.hidden = true;
    setBusy(sendButton, true, '송금 중…');
    editButton.disabled = true;
    try {
      const res = await tx.submit();
      tx = null;
      await showResult(res);
    } catch (err) {
      if (err.uncertain) {
        // 키와 본문을 유지한다. 다시 누르면 같은 키로 보낸다.
        document.getElementById('transfer-history').href = transactionsLink(draft.fromAccount);
        uncertainBox.hidden = false;
        setBusy(sendButton, false);
        sendButton.textContent = '같은 내용으로 다시 시도';
      } else if (!err.handled) {
        await showRejected(err);
      }
    } finally {
      if (sendButton.disabled) setBusy(sendButton, false);
      editButton.disabled = false;
    }
  });

  // ---- 3. 결과 ------------------------------------------------------------

  async function showResult(res) {
    const resultStep = steps.result;
    clearErrors(resultStep);
    document.getElementById('result-id').textContent = res.transferId;
    document.getElementById('result-status').textContent = res.status;
    document.getElementById('result-amount').textContent = formatAmount(draft.amount);
    document.getElementById('result-history').href = transactionsLink(draft.fromAccount);
    const list = document.getElementById('result-balances');
    list.replaceChildren();
    showStep('result');

    // 출금 계좌는 항상, 받는 계좌는 내 계좌일 때만 재조회한다(타인 계좌는 404).
    const targets = [draft.fromAccount];
    if (myAccounts.some((a) => a.number === draft.toAccount)) targets.push(draft.toAccount);
    for (const number of targets) {
      try {
        const balance = await refreshBalance(number);
        list.append(el('li', {}, [
          el('span', { className: 'account-number', textContent: number }),
          el('span', { className: 'balance', textContent: formatAmount(balance) }),
        ]));
      } catch (err) {
        showApiError(resultStep, err);
      }
    }
    renderFromBalance();
  }

  document.getElementById('new-transfer').addEventListener('click', () => {
    form.toAccount.value = '';
    form.amount.value = '';
    clearErrors(form);
    draft = null;
    showStep('input');
  });

  // ---- 시작 ---------------------------------------------------------------

  async function load() {
    const loading = document.getElementById('transfer-loading');
    try {
      myAccounts = await api.listAccounts();
    } catch (err) {
      const box = document.getElementById('load-error');
      box.hidden = false;
      showApiError(box, err);
      return;
    } finally {
      loading.hidden = true;
    }
    if (myAccounts.length === 0) {
      document.getElementById('no-accounts').hidden = false;
      return;
    }
    fromSelect.replaceChildren(...myAccounts.map((a) => el('option', { value: a.number, textContent: a.number })));
    const preset = new URLSearchParams(location.search).get('from');
    if (preset && myAccounts.some((a) => a.number === preset)) fromSelect.value = preset;
    renderFromBalance();
    showStep('input');
  }

  load();
}
