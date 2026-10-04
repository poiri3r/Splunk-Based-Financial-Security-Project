// 즉시이체 (작업 요청서 A3·A8·R8, 흐름도 F6·F13).
// 1) 입력 → 수취 계좌 확인(receiver-validation) → 서버 확인 건(preview, 5분) 생성
// 2) 확인 화면은 입력값이 아니라 서버 preview 응답을 그린다 → 로그인 비밀번호·계좌 비밀번호로 승인(step-up) → actionToken
// 3) 멱등키로 실행. 결과가 불확실하면 승인을 새로 받지 않고 같은 키·같은 본문으로 다시 보낸다.
// 입력을 바꾸면 새 preview와 새 승인이 필요하다. preview는 잔액을 예약하지 않으므로 실행 때 서버가 다시 검사한다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { parseAmount, validateAccountNumber, validatePinFormat } from '../validate.js';
import { formatAmount, formatDateTime, formatRemaining } from '../format.js';
import {
  clearErrors, showFieldError, showFormError, showApiError, setBusy, el, guardUnload, setDisabled,
  transactionsLink, transferResultLink, accountLabel, isDebitCandidate,
} from '../ui.js';
import { bindStepUpWait, noteStepUpLimit } from '../step-up-wait.js';

if (requireAuth()) init();

function init() {
  const steps = Object.fromEntries([...document.querySelectorAll('[data-step]')].map((node) => [node.dataset.step, node]));
  const stepLabels = document.querySelectorAll('[data-step-label]');
  const form = document.getElementById('transfer-form');
  const fromSelect = form.fromAccountId;
  const fromBalance = document.getElementById('from-balance');
  const nextButton = form.querySelector('button[type="submit"]');
  const approveForm = document.getElementById('approve-form');
  const sendButton = document.getElementById('send-transfer');
  const editButton = document.getElementById('edit-transfer');
  const uncertainBox = document.getElementById('transfer-uncertain');
  const timerNode = document.getElementById('confirm-timer');

  let myAccounts = []; // 서버 계좌 상세. 잔액은 계산하지 않고 조회 값만 쓴다.
  let preview = null; // 서버 확인 건 { previewId, details, amount, fee, expiresAt }
  let actionToken = null; // 이 preview에 대한 승인 권한
  let tx = null; // 실행 요청 한 건(멱등키 + 고정 본문)
  let timer = null;
  // 승인(step-up)을 보내야 하는 상태에서만 대기 제한을 건다. 결과 불명 재시도·이미 승인받은 실행은 step-up이 아니다.
  const stepUpWait = bindStepUpWait(approveForm, [sendButton], { isApplicable: () => Boolean(preview) && !tx && !actionToken });

  function showStep(name) {
    for (const [key, node] of Object.entries(steps)) node.hidden = key !== name;
    stepLabels.forEach((li) => li.classList.toggle('active', li.dataset.stepLabel === name));
  }

  function renderFromBalance() {
    const a = myAccounts.find((x) => x.accountId === fromSelect.value);
    fromBalance.textContent = a ? `잔액 ${formatAmount(a.balance)} · 출금 가능액 ${formatAmount(a.availableBalance)}` : '';
  }
  fromSelect.addEventListener('change', renderFromBalance);

  async function refreshAccount(accountId) {
    const detail = await api.getAccount(accountId);
    const i = myAccounts.findIndex((a) => a.accountId === accountId);
    if (i >= 0) myAccounts[i] = detail;
    renderFromBalance();
  }

  // 확인 건을 버리고 입력 단계로 돌아간다. 결과 불명인 실행이 있으면 돌아가지 않는다.
  function backToInput(message) {
    if (tx?.pending) return;
    preview = null;
    actionToken = null;
    tx = null;
    clearInterval(timer);
    approveForm.reset();
    showStep('input');
    clearErrors(form);
    if (message) showFormError(form, message);
  }

  // ---- 1. 입력 → preview --------------------------------------------------

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const fromAccountId = fromSelect.value;
    const toAccountNumber = form.toAccountNumber.value.trim().replace(/-/g, '');
    const memo = form.memo.value.trim();
    if (!fromAccountId) return showFieldError(form, 'fromAccountId', '출금 계좌를 선택해 주세요.');
    const toError = validateAccountNumber(toAccountNumber);
    if (toError) return showFieldError(form, 'toAccountNumber', toError);
    const from = myAccounts.find((a) => a.accountId === fromAccountId);
    if (from && from.number === toAccountNumber) {
      return showFieldError(form, 'toAccountNumber', '출금 계좌와 같은 계좌로는 이체할 수 없습니다.');
    }
    const { value: amount, error } = parseAmount(form.amount.value);
    if (error) return showFieldError(form, 'amount', error);

    setBusy(nextButton, true, '확인 중…');
    try {
      await api.validateReceiver(toAccountNumber); // 수취 계좌 존재·상태 확인
      preview = await api.createPreview({ fromAccountId, toAccountNumber, amount, memo: memo || null });
    } catch (err) {
      showApiError(form, err, {
        ACCOUNT_NOT_FOUND: { field: 'toAccountNumber', message: '받는 계좌를 찾을 수 없습니다. 계좌번호를 확인해 주세요.' },
        ACCOUNT_UNAVAILABLE: { field: 'toAccountNumber', message: '받을 수 없는 계좌입니다(해지 등).' },
        SAME_ACCOUNT: { field: 'toAccountNumber', message: '출금 계좌와 같은 계좌로는 이체할 수 없습니다.' },
        PRODUCT_ACCOUNT_RESTRICTED: { message: '입출금 계좌 사이에서만 이체할 수 있습니다. 예금·적금 계좌는 상품 상세에서 처리해 주세요.' },
      });
      return;
    } finally {
      setBusy(nextButton, false);
    }
    showConfirm();
  });

  // ---- 2. 확인·승인 → 실행 -------------------------------------------------

  function showConfirm() {
    const d = preview.details;
    document.getElementById('confirm-from').textContent = d.fromAccountNumber;
    const mine = myAccounts.some((a) => a.number === d.toAccountNumber);
    document.getElementById('confirm-to').textContent = mine ? `${d.toAccountNumber} (내 계좌)` : d.toAccountNumber;
    document.getElementById('confirm-name').textContent = d.receiverName;
    document.getElementById('confirm-amount').textContent = formatAmount(preview.amount);
    document.getElementById('confirm-fee').textContent = formatAmount(preview.fee);
    document.getElementById('confirm-memo').textContent = d.memo || '없음';
    clearErrors(approveForm);
    approveForm.reset();
    actionToken = null;
    tx = null;
    lockConfirm(false);
    const expiresAt = Date.parse(preview.expiresAt);
    const tick = () => {
      const left = expiresAt - Date.now();
      if (left <= 0 && !tx?.pending) return backToInput('확인 시간(5분)이 지났습니다. 내용을 확인하고 다시 진행해 주세요.');
      timerNode.textContent = left > 0 ? `${formatRemaining(left)} 안에 승인해 주세요.` : '';
    };
    clearInterval(timer);
    timer = setInterval(tick, 1000);
    tick();
    showStep('confirm');
    stepUpWait.sync(); // 다른 화면에서 걸린 제한도 이어서 보여 준다
    approveForm.password.focus();
  }

  // 결과 불명 중에는 수정·승인 입력을 막고 같은 요청으로만 다시 보낸다.
  function lockConfirm(locked) {
    setDisabled([editButton, approveForm.password, approveForm.pin], locked);
    uncertainBox.hidden = !locked;
    guardUnload(locked);
    sendButton.textContent = locked ? '같은 내용으로 다시 시도' : '이체하기';
  }

  editButton.addEventListener('click', () => backToInput());

  async function approve() {
    const password = approveForm.password.value;
    const pin = approveForm.pin.value;
    if (!password) { showFieldError(approveForm, 'password', '로그인 비밀번호를 입력해 주세요.'); return false; }
    const pinError = validatePinFormat(pin);
    if (pinError) { showFieldError(approveForm, 'pin', pinError); return false; }
    try {
      const res = await api.stepUp({ purpose: 'TRANSFER', targetId: preview.previewId, password, pin });
      actionToken = res.actionToken;
      approveForm.password.value = '';
      approveForm.pin.value = '';
      return true;
    } catch (err) {
      switch (err.code) {
        case 'PREVIEW_EXPIRED':
        case 'TRANSFER_NOT_FOUND':
          backToInput('확인 건이 만료되었습니다. 다시 진행해 주세요.');
          return false;
        case 'PREVIEW_ALREADY_USED':
          backToInput('이미 실행된 확인 건입니다. 이체결과조회에서 결과를 확인해 주세요.');
          return false;
        default:
          if (noteStepUpLimit(err)) { // 남은 시간 안내는 stepUpWait가 한다. 입력한 비밀번호를 자동으로 다시 보내지 않는다.
            approveForm.password.value = '';
            approveForm.pin.value = '';
            return false;
          }
          showApiError(approveForm, err, {
            REAUTHENTICATION_FAILED: { field: 'password', message: '로그인 비밀번호가 올바르지 않습니다.' },
            PIN_INVALID: { field: 'pin', message: '계좌 비밀번호가 올바르지 않습니다. 4번 틀리면 잠깁니다.' },
            RATE_LIMITED: { message: '승인 요청이 너무 많습니다. 5분 뒤 다시 시도해 주세요.' },
          });
          return false;
      }
    }
  }

  approveForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!preview || stepUpWait.isWaiting()) return;
    clearErrors(approveForm);
    setBusy(sendButton, true, '이체 중…');
    editButton.disabled = true;
    try {
      if (!tx) {
        if (!actionToken && !(await approve())) return;
        tx = api.newTransferExecution(preview.previewId, actionToken);
      }
      const res = await tx.submit();
      lockConfirm(false);
      await showResult(res);
    } catch (err) {
      if (err.uncertain) {
        lockConfirm(true);
        return;
      }
      tx = null;
      lockConfirm(false);
      if (!err.handled) await showRejected(err);
    } finally {
      setBusy(sendButton, false);
      if (tx?.pending) sendButton.textContent = '같은 내용으로 다시 시도';
      editButton.disabled = Boolean(tx?.pending);
      stepUpWait.sync();
    }
  });

  // 실행 거절(4xx). 키는 이미 폐기됐다.
  async function showRejected(err) {
    switch (err.code) {
      case 'ACTION_TOKEN_INVALID':
        // 승인 만료·계좌 보안 설정 변경. 같은 확인 건으로 다시 승인받는다.
        actionToken = null;
        showFormError(approveForm, '승인이 만료되었거나 계좌 보안 설정이 바뀌었습니다. 비밀번호를 다시 입력해 주세요.');
        return;
      case 'PREVIEW_EXPIRED':
        backToInput('확인 시간이 지났습니다. 다시 진행해 주세요.');
        return;
      case 'PREVIEW_ALREADY_USED':
        backToInput('이미 실행된 확인 건입니다. 이체결과조회에서 결과를 확인해 주세요.');
        return;
      default: {
        const fromAccountId = fromSelect.value;
        backToInput();
        showApiError(form, err);
        // 잔액·한도 거절이면 최신 잔액을 다시 보여 준다.
        try { await refreshAccount(fromAccountId); } catch (e) { if (!e.handled) console.warn('[transfer] 잔액 재조회 실패'); }
      }
    }
  }

  // ---- 3. 결과 ------------------------------------------------------------

  async function showResult(res) {
    clearInterval(timer);
    const fromAccountId = preview.details.fromAccountId;
    preview = null;
    actionToken = null;
    tx = null;
    document.getElementById('result-id').textContent = res.transferId;
    document.getElementById('result-time').textContent = formatDateTime(res.createdAt);
    document.getElementById('result-to').textContent = `${res.details.toAccountNumber} (${res.details.receiverName})`;
    document.getElementById('result-amount').textContent = formatAmount(res.amount);
    document.getElementById('result-balance').textContent = formatAmount(res.balanceAfter);
    document.getElementById('result-detail').href = transferResultLink(res.transferId);
    document.getElementById('result-history').href = transactionsLink(fromAccountId);
    showStep('result');
    // 이미 성공한 이체다. 잔액 재조회가 실패해도 결과를 바꾸지 않는다.
    try { await refreshAccount(fromAccountId); } catch (e) { if (!e.handled) console.warn('[transfer] 잔액 재조회 실패'); }
  }

  document.getElementById('new-transfer').addEventListener('click', () => {
    form.toAccountNumber.value = '';
    form.amount.value = '';
    form.memo.value = '';
    backToInput();
  });

  // ---- 시작 ---------------------------------------------------------------

  async function loadBeneficiaries() {
    try {
      const { items } = await api.listBeneficiaries();
      if (items.length === 0) return;
      const select = document.getElementById('beneficiary');
      select.append(...items.map((b) => el('option', { value: b.accountNumber, textContent: `${b.alias || '별명 없음'} ${b.accountNumber}` })));
      select.addEventListener('change', () => { if (select.value) form.toAccountNumber.value = select.value; });
      document.getElementById('beneficiary-field').hidden = false;
    } catch (err) {
      if (!err.handled) console.warn('[transfer] 자주 쓰는 계좌를 불러오지 못했습니다.');
    }
  }

  async function load() {
    const loading = document.getElementById('transfer-loading');
    try {
      myAccounts = (await api.listAccounts()).items;
    } catch (err) {
      const box = document.getElementById('load-error');
      box.hidden = false;
      showApiError(box, err);
      return;
    } finally {
      loading.hidden = true;
    }
    const candidates = myAccounts.filter(isDebitCandidate);
    if (candidates.length === 0) {
      document.getElementById('no-accounts').hidden = false;
      return;
    }
    fromSelect.replaceChildren(...candidates.map((a) => el('option', { value: a.accountId, textContent: accountLabel(a) })));
    const preset = new URLSearchParams(location.search).get('from');
    if (preset && candidates.some((a) => a.accountId === preset)) fromSelect.value = preset;
    renderFromBalance();
    showStep('input');
    loadBeneficiaries();
  }

  load();
}
