// 예금·적금 가입 (작업 요청서 R5, 흐름도 F10·F13): 상품확인·약관 → 출금 계좌·금액 → 확인·승인 → 완료.
// - 상품·약관 버전·금액 범위·기간은 서버 상품 목록에서 읽는다. 기간은 상품의 months로 고정된다.
// - 가입은 별도 preview/step-up 없이 로그인 비밀번호·계좌 비밀번호를 본문에 담아 보낸다. 응답은 200 가입 객체다.
// - 돈이 움직이므로 멱등키를 쓴다. 결과가 불확실하면 같은 키·같은 본문으로만 다시 보낸다(비밀번호 입력도 잠근다).
// - 잔액은 계산하지 않고 항상 조회 값을 쓴다. 성공 뒤 잔액 조회 실패를 가입 실패로 바꾸지 않는다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { parseAmount, validatePinFormat } from '../validate.js';
import { compareMoney } from '../money.js';
import { formatAmount, formatRate, formatDate } from '../format.js';
import {
  clearErrors, showFieldError, showFormError, showApiError, setBusy, el, guardUnload, setDisabled,
  transactionsLink, savingsDetailLink, accountLabel, isDebitCandidate,
} from '../ui.js';
import { amountLabel, isInstallment } from '../savings.js';

if (requireAuth()) init();

async function init() {
  const productId = new URLSearchParams(location.search).get('product');
  let product = null;
  try {
    product = (await api.savingsProducts()).find((p) => p.productId === productId) ?? null;
  } catch (err) {
    showApiError(document.getElementById('join-missing'), err);
  } finally {
    document.getElementById('product-loading').hidden = true;
  }
  if (!product) {
    document.getElementById('join-missing').hidden = false;
    return;
  }
  document.getElementById('join-flow').hidden = false;
  start(product);
}

function start(product) {
  const installment = isInstallment(product.accountType);
  const steps = Object.fromEntries([...document.querySelectorAll('[data-step]')].map((node) => [node.dataset.step, node]));
  const stepLabels = document.querySelectorAll('[data-step-label]');
  const termsForm = document.getElementById('terms-form');
  const infoForm = document.getElementById('info-form');
  const fromSelect = infoForm.sourceAccountId;
  const fromBalance = document.getElementById('from-balance');
  const approveForm = document.getElementById('approve-form');
  const submitButton = document.getElementById('join-submit');
  const backButton = document.getElementById('confirm-back');
  const uncertainBox = document.getElementById('join-uncertain');

  let accounts = []; // 출금 가능한 입출금 계좌 (서버 값)
  let draft = null; // { sourceAccountId, amount }
  let tx = null; // 가입 요청 한 건

  function showStep(name) {
    for (const [key, node] of Object.entries(steps)) node.hidden = key !== name;
    stepLabels.forEach((li) => li.classList.toggle('active', li.dataset.stepLabel === name));
  }
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.back)));

  // ---- 1. 상품확인·약관 ---------------------------------------------------

  const range = `${installment ? '매회 ' : ''}${formatAmount(product.minimum)} ~ ${formatAmount(product.maximum)}`;
  document.getElementById('product-name').textContent = product.name;
  document.getElementById('product-rate').textContent = formatRate(product.annualRate);
  document.getElementById('product-early').textContent = formatRate(product.earlyRate);
  document.getElementById('product-term').textContent = `${product.months}개월 (고정)`;
  document.getElementById('product-amount-label').textContent = amountLabel(product.accountType);
  document.getElementById('product-amount').textContent = range;
  document.getElementById('product-terms').textContent = product.termsText;
  document.getElementById('terms-version').textContent = product.termsVersion;

  termsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(termsForm);
    if (!termsForm.agree.checked) return showFormError(termsForm, '약관에 동의해 주세요.');
    showStep('info');
  });

  // ---- 2. 가입정보 --------------------------------------------------------

  document.getElementById('amount-label').textContent = `${amountLabel(product.accountType)} (원)`;
  document.getElementById('amount-hint').textContent = installment
    ? `${range}. 첫 회차는 가입할 때 바로 출금되고, 이후에는 매월 직접 납입합니다(자동이체 없음).`
    : `${range}. 가입할 때 바로 출금됩니다.`;

  function renderFromBalance() {
    const a = accounts.find((x) => x.accountId === fromSelect.value);
    fromBalance.textContent = a ? `잔액 ${formatAmount(a.balance)}` : '';
  }
  fromSelect.addEventListener('change', renderFromBalance);

  async function refreshAccount(accountId) {
    const detail = await api.getAccount(accountId);
    accounts = accounts.map((a) => (a.accountId === accountId ? detail : a));
    renderFromBalance();
    return detail;
  }

  async function loadAccounts() {
    try {
      accounts = (await api.listAccounts()).items.filter(isDebitCandidate);
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
    fromSelect.replaceChildren(...accounts.map((a) => el('option', { value: a.accountId, textContent: accountLabel(a) })));
    renderFromBalance();
    document.getElementById('info-fields').hidden = false;
  }

  infoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(infoForm);
    const sourceAccountId = fromSelect.value;
    if (!sourceAccountId) return showFieldError(infoForm, 'sourceAccountId', '출금 계좌를 선택해 주세요.');
    const { value: amount, error } = parseAmount(infoForm.amount.value);
    if (error) return showFieldError(infoForm, 'amount', error);
    // 범위 검사는 입력 편의용이다(문자열 비교, 반올림 없음). 최종 판단은 서버가 한다.
    if (compareMoney(amount, product.minimum) < 0 || compareMoney(amount, product.maximum) > 0) {
      return showFieldError(infoForm, 'amount', `${amountLabel(product.accountType)}은 ${range}입니다.`);
    }

    draft = { sourceAccountId, amount };
    tx = null;
    const from = accounts.find((a) => a.accountId === sourceAccountId);
    document.getElementById('confirm-product').textContent = product.name;
    document.getElementById('confirm-from').textContent = from ? accountLabel(from) : '';
    document.getElementById('confirm-amount-label').textContent = amountLabel(product.accountType);
    document.getElementById('confirm-amount').textContent = formatAmount(amount);
    document.getElementById('confirm-term').textContent = `${product.months}개월`;
    document.getElementById('confirm-rate').textContent = `${formatRate(product.annualRate)} (중도해지 ${formatRate(product.earlyRate)})`;
    document.getElementById('confirm-note').textContent = installment
      ? '가입하면 첫 회차 납입액이 출금 계좌에서 바로 빠져나갑니다. 이체한도의 일일 사용액에 포함됩니다.'
      : '가입하면 가입 금액이 출금 계좌에서 바로 빠져나갑니다. 이체한도의 일일 사용액에 포함됩니다.';
    clearErrors(approveForm);
    approveForm.reset();
    lock(false);
    showStep('confirm');
    approveForm.password.focus();
  });

  // ---- 3. 확인·승인 → 가입 ------------------------------------------------

  function lock(locked) {
    setDisabled([backButton, approveForm.password, approveForm.pin], locked);
    uncertainBox.hidden = !locked;
    guardUnload(locked);
    submitButton.textContent = locked ? '같은 내용으로 다시 시도' : '가입하기';
  }

  backButton.addEventListener('click', () => {
    if (tx?.pending) return;
    tx = null;
    showStep('info');
  });

  approveForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(approveForm);
    if (!tx) {
      const password = approveForm.password.value;
      const pin = approveForm.pin.value;
      if (!password) return showFieldError(approveForm, 'password', '로그인 비밀번호를 입력해 주세요.');
      const pinError = validatePinFormat(pin);
      if (pinError) return showFieldError(approveForm, 'pin', pinError);
      tx = api.newSavingsJoin({ productId: product.productId, termsVersion: product.termsVersion, ...draft, password, pin });
    }
    setBusy(submitButton, true, '가입 중…');
    try {
      const res = await tx.submit(); // 200 가입 객체
      tx = null;
      lock(false);
      approveForm.reset();
      await showResult(res);
    } catch (err) {
      setBusy(submitButton, false);
      if (err.uncertain) {
        lock(true);
        return;
      }
      tx = null;
      lock(false);
      if (!err.handled) await showRejected(err);
    } finally {
      if (submitButton.disabled && !tx?.pending) setBusy(submitButton, false);
    }
  });

  // 거절(4xx): 키는 폐기됐다. 승인 입력 오류는 이 단계에, 금액·계좌 문제는 입력 단계에 표시한다.
  async function showRejected(err) {
    approveForm.password.value = '';
    approveForm.pin.value = '';
    switch (err.code) {
      case 'REAUTHENTICATION_FAILED':
        return showFieldError(approveForm, 'password', '로그인 비밀번호가 올바르지 않습니다.');
      case 'PIN_INVALID':
        return showFieldError(approveForm, 'pin', '계좌 비밀번호가 올바르지 않습니다. 4번 틀리면 잠깁니다.');
      case 'RATE_LIMITED':
        return showFormError(approveForm, '비밀번호 확인 요청이 너무 많습니다. 5분 뒤 다시 시도해 주세요.');
      case 'TERMS_VERSION_MISMATCH':
      case 'PRODUCT_NOT_FOUND':
        showStep('terms');
        return showFormError(termsForm, '상품 약관이 바뀌었거나 가입할 수 없는 상품입니다. 상품 목록에서 다시 선택해 주세요.');
      default:
        showStep('info');
        showApiError(infoForm, err, {
          PRODUCT_AMOUNT_INVALID: { field: 'amount', message: `${amountLabel(product.accountType)}은 ${range}입니다.` },
        });
        if (['INSUFFICIENT_BALANCE', 'PIN_LOCKED', 'DEBIT_DISABLED'].includes(err.code)) {
          try { await refreshAccount(draft.sourceAccountId); } catch (e) { if (!e.handled) console.warn('[product-join] 잔액 재조회 실패'); }
        }
    }
  }

  // ---- 4. 완료 ------------------------------------------------------------

  async function showResult(res) {
    const done = steps.done;
    clearErrors(done);
    document.getElementById('result-product').textContent = product.name;
    document.getElementById('result-account').textContent = res.accountNumber;
    document.getElementById('result-opened').textContent = formatDate(res.openedOn);
    document.getElementById('result-maturity').textContent = formatDate(res.maturityOn);
    document.getElementById('result-principal').textContent = formatAmount(res.principal);
    document.getElementById('result-history').href = transactionsLink(draft.sourceAccountId);
    document.getElementById('result-detail').href = savingsDetailLink(res.subscriptionId);
    const balanceNode = document.getElementById('result-balance');
    balanceNode.textContent = '조회 중…';
    showStep('done');
    try {
      balanceNode.textContent = formatAmount((await refreshAccount(draft.sourceAccountId)).balance);
    } catch (err) {
      balanceNode.textContent = '-';
      if (!err.handled) showFormError(done, '가입은 완료되었습니다. 잔액은 잠시 후 거래내역에서 확인해 주세요.');
    }
  }

  showStep('terms');
  loadAccounts();
}
