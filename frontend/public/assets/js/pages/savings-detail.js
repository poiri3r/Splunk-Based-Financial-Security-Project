// 예금·적금 상세·납입·해지 (작업 요청서 A6, 흐름도 F11·F12·F13). ?id=<subscriptionId>
// - 납입(적금만): 금액은 보내지 않는다. 서버가 가입한 installment와 월 회차를 판단한다.
// - 해지: 서버 견적(closure-quote)을 받아 보여 주고, 그 견적의 version·quoteDate·quoteToken을 그대로 보내 해지한다.
//   금리·이자를 브라우저에서 계산해 확정하지 않는다. 해지에는 로그인 비밀번호만 필요하다(PIN 없음).
// - 납입·해지는 멱등키를 쓴다. 결과가 불확실하면 같은 키·같은 본문으로만 다시 보낸다.
// - QUOTE_STALE·VERSION_CONFLICT면 상세와 견적을 다시 읽고 사용자에게 바뀐 내용을 다시 확인받는다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { validatePinFormat } from '../validate.js';
import { formatAmount, formatRate, formatDate } from '../format.js';
import {
  clearErrors, showFieldError, showFormError, showApiError, setBusy, el, guardUnload, setDisabled,
  transactionsLink, accountLabel, isDebitCandidate,
} from '../ui.js';
import { amountLabel, isInstallment, statusLabel, kstToday } from '../savings.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (requireAuth()) init();

function init() {
  const id = new URLSearchParams(location.search).get('id');
  const section = document.getElementById('detail-section');
  const payForm = document.getElementById('pay-form');
  const quoteForm = document.getElementById('quote-form');
  const closeForm = document.getElementById('close-form');
  const quoteBox = document.getElementById('quote-box');

  let sub = null; // 가입 객체 (서버 값)
  let product = null;
  let checking = []; // 정상 입출금 계좌
  let payTx = null;
  let quote = null; // 서버 견적
  let closeTx = null;

  // ---- 상세 ---------------------------------------------------------------

  function render() {
    const today = kstToday();
    const installment = isInstallment(product?.accountType);
    document.getElementById('s-name').textContent = product?.name ?? sub.productId;
    const status = document.getElementById('s-status');
    status.textContent = statusLabel(sub, today);
    status.className = `tag ${sub.status === 'ACTIVE' ? 'in' : 'out'}`;
    document.getElementById('s-account').textContent = sub.accountNumber;
    document.getElementById('s-principal').textContent = formatAmount(sub.principal);
    document.getElementById('s-installment-label').textContent = amountLabel(product?.accountType);
    document.getElementById('s-installment').textContent = formatAmount(sub.installment);
    document.getElementById('s-rate').textContent = `${formatRate(sub.annualRate)} (중도해지 ${formatRate(sub.earlyRate)})`;
    document.getElementById('s-opened').textContent = formatDate(sub.openedOn);
    document.getElementById('s-maturity').textContent = formatDate(sub.maturityOn);
    document.getElementById('s-closed').textContent = sub.closedOn ? formatDate(sub.closedOn) : '-';
    document.getElementById('s-terms').textContent = sub.termsVersion;
    document.getElementById('s-payment-body').replaceChildren(...sub.payments.map((p) => el('tr', {}, [
      el('td', { textContent: `${p.period + 1}회차` }),
      el('td', { textContent: formatDate(p.paidOn) }),
      el('td', { className: 'num plain', textContent: formatAmount(p.amount) }),
    ])));
    document.getElementById('s-summary').hidden = false;

    const active = sub.status === 'ACTIVE';
    // 납입 버튼 노출은 안내용이다. 회차·기간은 서버가 다시 판단한다.
    document.getElementById('pay-section').hidden = !(active && installment && today < sub.maturityOn);
    document.getElementById('pay-amount').textContent = formatAmount(sub.installment);
    document.getElementById('close-section').hidden = !active && !closeTx?.pending;
  }

  async function loadDetail() {
    sub = await api.getSavings(id);
    render();
  }

  // ---- 납입 ---------------------------------------------------------------

  function lockPay(locked) {
    setDisabled([payForm.sourceAccountId, payForm.pin], locked);
    document.getElementById('pay-uncertain').hidden = !locked;
    guardUnload(locked || Boolean(closeTx?.pending));
    document.getElementById('pay-submit').textContent = locked ? '같은 내용으로 다시 시도' : '납입하기';
  }

  payForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(payForm);
    document.getElementById('pay-done').hidden = true;
    if (!payTx) {
      const sourceAccountId = payForm.sourceAccountId.value;
      const pin = payForm.pin.value; // 2026-10-04 합의: 납입은 출금 계좌 비밀번호(PIN)만 받는다
      if (!sourceAccountId) return showFieldError(payForm, 'sourceAccountId', '출금 계좌를 선택해 주세요.');
      const pinError = validatePinFormat(pin);
      if (pinError) return showFieldError(payForm, 'pin', pinError);
      payTx = api.newSavingsPayment(id, { sourceAccountId, version: sub.version, pin });
    }
    const button = document.getElementById('pay-submit');
    setBusy(button, true, '납입 중…');
    try {
      sub = await payTx.submit(); // 최신 가입 객체
      payTx = null;
      lockPay(false);
      payForm.reset();
      render();
      document.getElementById('pay-done').hidden = false;
    } catch (err) {
      setBusy(button, false);
      if (err.uncertain) return lockPay(true);
      payTx = null;
      lockPay(false);
      payForm.pin.value = '';
      if (['VERSION_CONFLICT', 'PERIOD_ALREADY_PAID', 'PAYMENT_PERIOD_CLOSED', 'SAVINGS_CLOSED'].includes(err.code)) {
        try { await loadDetail(); } catch (e) { if (!e.handled) console.warn('[savings] 상세 재조회 실패'); }
      }
      showApiError(payForm, err, {
        PIN_INVALID: { field: 'pin', message: '계좌 비밀번호가 올바르지 않습니다. 4번 틀리면 잠깁니다.' },
        VERSION_CONFLICT: { message: '가입 정보가 그사이 바뀌었습니다. 최신 내용을 확인하고 다시 납입해 주세요.' },
        PERIOD_ALREADY_PAID: { message: '이번 회차는 이미 납입했습니다. 다음 회차에 납입해 주세요.' },
        PAYMENT_PERIOD_CLOSED: { message: '납입 기간이 끝났습니다(만기 이후 납입 불가).' },
        PAYMENT_NOT_SUPPORTED: { message: '예금은 추가 납입할 수 없습니다.' },
        SAVINGS_CLOSED: { message: '이미 해지된 상품입니다.' },
        RATE_LIMITED: { message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
      });
    } finally {
      if (!payTx?.pending) setBusy(button, false);
    }
  });

  // ---- 해지 ---------------------------------------------------------------

  function discardQuote() {
    if (closeTx?.pending) return;
    quote = null;
    closeTx = null;
    quoteBox.hidden = true;
    closeForm.reset();
  }
  quoteForm.targetAccountId.addEventListener('change', discardQuote);

  function renderQuote() {
    document.getElementById('q-date').textContent = `(${formatDate(quote.quoteDate)} 기준)`;
    document.getElementById('q-type').textContent = quote.closureType === 'MATURE' ? '만기 해지' : '중도 해지 (중도해지 금리 적용)';
    document.getElementById('q-principal').textContent = formatAmount(quote.principal);
    document.getElementById('q-interest').textContent = formatAmount(quote.interest);
    document.getElementById('q-tax').textContent = formatAmount(quote.tax);
    document.getElementById('q-total').textContent = formatAmount(quote.total);
    quoteBox.hidden = false;
  }

  async function requestQuote(scope) {
    const targetAccountId = quoteForm.targetAccountId.value;
    if (!targetAccountId) {
      showFieldError(quoteForm, 'targetAccountId', '받을 계좌를 선택해 주세요.');
      return false;
    }
    try {
      quote = await api.closureQuote(id, targetAccountId);
      closeTx = null;
      renderQuote();
      return true;
    } catch (err) {
      quote = null;
      quoteBox.hidden = true;
      showApiError(scope, err, { SAVINGS_CLOSED: { message: '이미 해지된 상품입니다.' } });
      return false;
    }
  }

  quoteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(quoteForm);
    clearErrors(closeForm);
    const button = document.getElementById('quote-submit');
    setBusy(button, true, '조회 중…');
    await requestQuote(quoteForm);
    setBusy(button, false);
  });

  function lockClose(locked) {
    setDisabled([quoteForm.targetAccountId, document.getElementById('quote-submit'), closeForm.password], locked);
    document.getElementById('close-uncertain').hidden = !locked;
    guardUnload(locked || Boolean(payTx?.pending));
    document.getElementById('close-submit').textContent = locked ? '같은 내용으로 다시 시도' : '이 견적으로 해지';
  }

  closeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(closeForm);
    if (!quote) return;
    if (!closeTx) {
      const password = closeForm.password.value;
      if (!password) return showFieldError(closeForm, 'password', '로그인 비밀번호를 입력해 주세요.');
      if (!window.confirm(`${formatAmount(quote.total)}을 받고 해지할까요? 해지는 되돌릴 수 없습니다.`)) return;
      closeTx = api.newSavingsClosure(id, {
        targetAccountId: quote.targetAccountId, version: quote.version, quoteDate: quote.quoteDate, quoteToken: quote.quoteToken, password,
      });
    }
    const button = document.getElementById('close-submit');
    setBusy(button, true, '해지 중…');
    try {
      const res = await closeTx.submit(); // 견적 필드 + status:'CLOSED', 새 version
      const target = quote.targetAccountId;
      closeTx = null;
      lockClose(false);
      quote = null;
      quoteBox.hidden = true;
      document.getElementById('close-result').textContent = `받은 금액 ${formatAmount(res.total)} (원금 ${formatAmount(res.principal)} + 모의 이자 ${formatAmount(res.interest)})`;
      document.getElementById('close-history').href = transactionsLink(target);
      document.getElementById('close-done').hidden = false;
      quoteForm.hidden = true;
      try { await loadDetail(); } catch (e) { if (!e.handled) console.warn('[savings] 상세 재조회 실패'); }
      document.getElementById('close-section').hidden = false; // 완료 안내는 계속 보인다
    } catch (err) {
      setBusy(button, false);
      if (err.uncertain) return lockClose(true);
      closeTx = null;
      lockClose(false);
      closeForm.password.value = '';
      if (err.code === 'QUOTE_STALE' || err.code === 'VERSION_CONFLICT') {
        // 날짜가 바뀌었거나 납입으로 버전이 달라졌다. 새 견적을 받아 다시 확인받는다.
        try { await loadDetail(); } catch (e) { if (!e.handled) console.warn('[savings] 상세 재조회 실패'); }
        if (await requestQuote(closeForm)) showFormError(closeForm, '견적이 바뀌었습니다. 새 견적을 확인한 뒤 다시 해지해 주세요.');
        return;
      }
      if (err.code === 'SAVINGS_CLOSED') {
        try { await loadDetail(); } catch (e) { if (!e.handled) console.warn('[savings] 상세 재조회 실패'); }
      }
      showApiError(closeForm, err, {
        REAUTHENTICATION_FAILED: { field: 'password', message: '로그인 비밀번호가 올바르지 않습니다.' },
        SAVINGS_CLOSED: { message: '이미 해지된 상품입니다.' },
        RATE_LIMITED: { message: '비밀번호 확인 요청이 너무 많습니다. 5분 뒤 다시 시도해 주세요.' },
      });
    } finally {
      if (!closeTx?.pending) setBusy(button, false);
    }
  });

  // ---- 시작 ---------------------------------------------------------------

  async function start() {
    if (!id || !UUID_RE.test(id)) {
      document.getElementById('s-loading').hidden = true;
      showFormError(section, '가입 정보를 찾을 수 없습니다. 가입내역에서 다시 선택해 주세요.');
      return;
    }
    try {
      const [detail, products, accounts] = await Promise.all([api.getSavings(id), api.savingsProducts(), api.listAccounts()]);
      sub = detail;
      product = products.find((p) => p.productId === sub.productId) ?? null;
      checking = accounts.items.filter(isDebitCandidate);
    } catch (err) {
      showApiError(section, err, {
        SAVINGS_NOT_FOUND: { message: '가입 정보가 없거나 접근할 수 없습니다. 가입내역에서 다시 선택해 주세요.' },
      });
      return;
    } finally {
      document.getElementById('s-loading').hidden = true;
    }
    const options = () => checking.map((a) => el('option', { value: a.accountId, textContent: accountLabel(a) }));
    payForm.sourceAccountId.replaceChildren(...options());
    quoteForm.targetAccountId.replaceChildren(...options());
    if (checking.length === 0) {
      showFormError(payForm, '출금할 수 있는 입출금 계좌가 없습니다.');
      showFormError(quoteForm, '받을 수 있는 입출금 계좌가 없습니다.');
    }
    render();
  }

  start();
}
