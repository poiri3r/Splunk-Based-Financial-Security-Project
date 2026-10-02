// 예금·적금 가입: 상품확인·약관 → 가입정보 → 확인 → 완료.
// 가입은 돈이 움직이므로 송금과 같은 규칙을 따른다.
// - 확인 단계로 넘어갈 때 멱등키를 만들고 본문을 고정한다. 이전으로 돌아가면 그 거래를 버린다.
// - 결과가 불확실하면 같은 키로 다시 보낸다. 4xx면 입력 단계로 돌아가 오류를 표시한다.
// - 잔액은 계산하지 않고 항상 조회 값을 쓴다.
// API는 백엔드 가안(docs/backend_request.docx 3-5)이며 현재는 목 서버만 응답한다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { parseAmount } from '../validate.js';
import { formatAmount } from '../format.js';
import {
  clearErrors, showFieldError, showFormError, showApiError, setBusy, el, transactionsLink,
} from '../ui.js';
import { findProduct, termsOf, PRODUCT_TYPES } from '../data/products.js';

const won = (n) => `${n.toLocaleString('ko-KR')}원`;

if (requireAuth()) init();

function init() {
  const product = findProduct(new URLSearchParams(location.search).get('product'));
  if (!product) {
    document.getElementById('join-missing').hidden = false;
    return;
  }
  document.getElementById('join-flow').hidden = false;

  const typeInfo = PRODUCT_TYPES[product.type];
  const isSavings = product.type === 'SAVINGS';
  const steps = Object.fromEntries(
    [...document.querySelectorAll('[data-step]')].map((node) => [node.dataset.step, node]),
  );
  const stepLabels = document.querySelectorAll('[data-step-label]');
  const termsForm = document.getElementById('terms-form');
  const infoForm = document.getElementById('info-form');
  const fromSelect = infoForm.fromAccount;
  const fromBalance = document.getElementById('from-balance');
  const confirmSection = document.getElementById('confirm-section');
  const submitButton = document.getElementById('join-submit');
  const backButton = document.getElementById('confirm-back');
  const uncertainBox = document.getElementById('join-uncertain');

  let accounts = []; // [{ number, balance }] 서버가 준 값
  let draft = null; // 확인 중인 입력값
  let tx = null; // 확인 단계에서 만든 거래 한 건

  function showStep(name) {
    for (const [key, node] of Object.entries(steps)) node.hidden = key !== name;
    stepLabels.forEach((li) => li.classList.toggle('active', li.dataset.stepLabel === name));
  }
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.back)));

  // ---- 1. 상품확인·약관 ---------------------------------------------------

  const amountRange = product.maxAmount === null
    ? `${won(product.minAmount)} 이상`
    : `${won(product.minAmount)} ~ ${won(product.maxAmount)}`;
  document.getElementById('product-type').textContent = typeInfo.label;
  document.getElementById('product-name').textContent = product.name;
  document.getElementById('product-desc').textContent = product.description;
  document.getElementById('product-rate').textContent = `연 ${product.rate.toFixed(2)}%`;
  document.getElementById('product-term').textContent = `${product.minTermMonths} ~ ${product.maxTermMonths}개월`;
  document.getElementById('product-amount-label').textContent = typeInfo.amountLabel;
  document.getElementById('product-amount').textContent = isSavings ? `월 ${amountRange}` : amountRange;

  const agreeAll = document.getElementById('agree-all');
  const agreeBoxes = [...termsForm.querySelectorAll('input[name="agree"]')];
  agreeAll.addEventListener('change', () => agreeBoxes.forEach((b) => { b.checked = agreeAll.checked; }));
  agreeBoxes.forEach((b) => b.addEventListener('change', () => { agreeAll.checked = agreeBoxes.every((x) => x.checked); }));

  termsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(termsForm);
    if (agreeBoxes.some((b) => !b.checked)) return showFormError(termsForm, '필수 약관에 모두 동의해 주세요.');
    showStep('info');
  });

  // ---- 2. 가입정보 --------------------------------------------------------

  document.getElementById('amount-label').textContent = `${typeInfo.amountLabel} (원)`;
  document.getElementById('amount-hint').textContent = isSavings
    ? `월 ${amountRange}. 첫 회차는 가입할 때 바로 출금됩니다.`
    : `${amountRange}. 가입할 때 바로 출금됩니다.`;
  infoForm.termMonths.replaceChildren(...termsOf(product).map((m) => el('option', { value: String(m), textContent: `${m}개월` })));

  function renderFromBalance() {
    const account = accounts.find((a) => a.number === fromSelect.value);
    fromBalance.textContent = account ? `잔액 ${formatAmount(account.balance)}` : '';
  }
  fromSelect.addEventListener('change', renderFromBalance);

  async function refreshBalance(number) {
    const res = await api.getBalance(number);
    const account = accounts.find((a) => a.number === number);
    if (account) account.balance = res.balance;
    return res.balance;
  }

  async function loadAccounts() {
    try {
      accounts = await api.listAccounts();
    } catch (err) {
      showApiError(infoForm, err);
      return;
    } finally {
      document.getElementById('accounts-loading').hidden = true;
    }
    if (accounts.length === 0) {
      document.getElementById('no-accounts').hidden = false;
      document.getElementById('info-next').disabled = true;
      return;
    }
    fromSelect.replaceChildren(...accounts.map((a) => el('option', { value: a.number, textContent: a.number })));
    renderFromBalance();
    document.getElementById('info-fields').hidden = false;
  }

  infoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(infoForm);
    const fromAccount = fromSelect.value;
    if (!fromAccount) return showFieldError(infoForm, 'fromAccount', '출금 계좌를 선택해 주세요.');
    const { value: amount, error } = parseAmount(infoForm.amount.value);
    if (error) return showFieldError(infoForm, 'amount', error);
    // 범위 검사는 입력 편의용이다. 최종 판단은 서버가 한다.
    if (amount < product.minAmount || (product.maxAmount !== null && amount > product.maxAmount)) {
      return showFieldError(infoForm, 'amount', `${typeInfo.amountLabel}은 ${amountRange}입니다.`);
    }
    const termMonths = Number(infoForm.termMonths.value);

    draft = { fromAccount, amount, termMonths };
    tx = api.newSubscription(product.productId, fromAccount, amount, termMonths);

    document.getElementById('confirm-product').textContent = product.name;
    document.getElementById('confirm-from').textContent = fromAccount;
    document.getElementById('confirm-amount-label').textContent = typeInfo.amountLabel;
    document.getElementById('confirm-amount').textContent = formatAmount(amount);
    document.getElementById('confirm-term').textContent = `${termMonths}개월`;
    document.getElementById('confirm-rate').textContent = `연 ${product.rate.toFixed(2)}%`;
    document.getElementById('confirm-note').textContent = isSavings
      ? '가입하면 첫 회차 납입액이 출금 계좌에서 바로 빠져나갑니다.'
      : '가입하면 가입 금액이 출금 계좌에서 바로 빠져나갑니다.';
    clearErrors(confirmSection);
    uncertainBox.hidden = true;
    submitButton.textContent = '가입하기';
    showStep('confirm');
    submitButton.focus();
  });

  // ---- 3. 확인 → 가입 -----------------------------------------------------

  backButton.addEventListener('click', () => {
    tx = null; // 다시 확인하면 새 키가 만들어진다
    showStep('info');
  });

  // 거절(4xx)은 입력 단계에 표시한다. 키는 이미 폐기됐다.
  async function showRejected(err) {
    tx = null;
    showStep('info');
    clearErrors(infoForm);
    switch (err.code) {
      case 'INSUFFICIENT_BALANCE':
        showFormError(infoForm, err.message);
        try {
          await refreshBalance(draft.fromAccount);
          renderFromBalance();
        } catch (e) {
          showApiError(infoForm, e);
        }
        return;
      case 'PRODUCT_NOT_FOUND':
        showFormError(infoForm, '현재 가입할 수 없는 상품입니다.');
        return;
      default:
        showApiError(infoForm, err);
    }
  }

  submitButton.addEventListener('click', async () => {
    if (!tx) return;
    clearErrors(confirmSection);
    uncertainBox.hidden = true;
    setBusy(submitButton, true, '가입 중…');
    backButton.disabled = true;
    try {
      const res = await tx.submit();
      tx = null;
      await showResult(res);
    } catch (err) {
      if (err.uncertain) {
        // 키와 본문을 유지한다. 다시 누르면 같은 키로 보낸다.
        uncertainBox.hidden = false;
        setBusy(submitButton, false);
        submitButton.textContent = '같은 내용으로 다시 시도';
      } else if (!err.handled) {
        await showRejected(err);
      }
    } finally {
      if (submitButton.disabled) setBusy(submitButton, false);
      backButton.disabled = false;
    }
  });

  // ---- 4. 완료 ------------------------------------------------------------

  async function showResult(res) {
    const done = steps.done;
    clearErrors(done);
    document.getElementById('result-product').textContent = product.name;
    document.getElementById('result-id').textContent = res.subscriptionId;
    document.getElementById('result-maturity').textContent = res.maturityDate ?? '-';
    document.getElementById('result-history').href = transactionsLink(draft.fromAccount);
    const balanceNode = document.getElementById('result-balance');
    balanceNode.textContent = '조회 중…';
    showStep('done');
    try {
      balanceNode.textContent = formatAmount(await refreshBalance(draft.fromAccount));
    } catch (err) {
      balanceNode.textContent = '-';
      showApiError(done, err);
    }
  }

  showStep('terms');
  loadAccounts();
}
