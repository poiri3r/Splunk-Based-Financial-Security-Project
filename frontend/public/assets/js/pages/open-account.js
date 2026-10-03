// 입출금 계좌개설 (작업 요청서 R4, 흐름도 F4, 추가 협의 C4): 약관 → 계좌 비밀번호·별명 → 확인 → 완료.
// - 서버가 저장하는 값은 { pin, termsVersion }뿐이다. 약관 버전은 GET /api/v2/terms의 CHECKING 항목에서 읽는다.
//   (CHECKING의 required=false는 '회원가입 약관이 아님'이라는 뜻이며 계좌개설에는 필수다)
// - 상품 종류(급여·청년), 거래 목적, 자금 출처, 알림, 마케팅 동의는 v6에 저장할 곳이 없어 화면에서 뺐다(C4 후속 범위).
// - 개설은 멱등키를 쓴다. 결과가 불확실하면 같은 키로 다시 보내 계좌가 하나만 생기게 한다.
// - 별명은 개설 후 preferences.alias로 따로 저장한다. 별명만 실패해도 계좌를 다시 만들지 않는다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { formatAmount, formatDateTime } from '../format.js';
import { validatePin } from '../validate.js';
import {
  clearErrors, showFieldError, showFormError, showApiError, setBusy, el, guardUnload, setDisabled,
  transactionsLink, depositLink, manageLink,
} from '../ui.js';

if (requireAuth()) init();

function init() {
  const steps = Object.fromEntries([...document.querySelectorAll('[data-step]')].map((node) => [node.dataset.step, node]));
  const stepLabels = document.querySelectorAll('[data-step-label]');
  const termsForm = document.getElementById('terms-form');
  const infoForm = document.getElementById('info-form');
  const confirmSection = document.getElementById('confirm-section');
  const openButton = document.getElementById('open-account');
  const confirmBack = document.getElementById('confirm-back');
  const uncertainBox = document.getElementById('open-uncertain');

  let checkingTerms = null; // { id:'CHECKING', version, text }
  let myPhone = null;
  let draft = null; // { pin, nickname }
  let tx = null; // 확인 단계에서 만든 개설 요청 한 건

  function showStep(name) {
    for (const [key, node] of Object.entries(steps)) node.hidden = key !== name;
    stepLabels.forEach((li) => li.classList.toggle('active', li.dataset.stepLabel === name));
    steps[name].querySelector('h2')?.scrollIntoView({ block: 'nearest' });
  }

  document.querySelectorAll('[data-back]').forEach((button) => {
    button.addEventListener('click', () => {
      if (tx?.pending) return;
      tx = null; // 이전으로 가면 확인한 요청을 버린다. 다시 확인하면 새 키가 만들어진다.
      showStep(button.dataset.back);
    });
  });

  // ---- 준비: 약관, 정보 보완 여부 ------------------------------------------

  async function loadTerms() {
    const loading = document.getElementById('terms-loading');
    loading.hidden = false;
    try {
      const { items } = await api.terms();
      checkingTerms = items.find((t) => t.id === 'CHECKING' || t.scope === 'ACCOUNT_OPEN') ?? null;
      if (!checkingTerms) throw new Error('CHECKING 약관이 없습니다.');
      const textBox = document.getElementById('terms-text');
      textBox.replaceChildren(el('p', { textContent: checkingTerms.text }));
      document.getElementById('terms-version').textContent = checkingTerms.version;
      termsForm.agree.checked = false;
      document.getElementById('terms-box').hidden = false;
    } catch (err) {
      showApiError(termsForm, err);
    } finally {
      loading.hidden = true;
    }
  }

  // 이름·모의 휴대폰 확인이 없으면 서버가 BANKING_SETUP_REQUIRED로 거절한다. 미리 안내한다.
  async function loadMe() {
    try {
      const me = await api.getMe();
      myPhone = me.phone;
      if (!me.bankingReady) document.getElementById('setup-required').hidden = false;
    } catch (err) {
      if (!err.handled) console.warn('[open-account] 내 정보를 불러오지 못했습니다.');
    }
  }

  // ---- 1. 약관 ------------------------------------------------------------

  termsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(termsForm);
    if (!checkingTerms) return showFormError(termsForm, '약관을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
    if (!termsForm.agree.checked) return showFormError(termsForm, '필수 약관에 동의해 주세요.');
    showStep('info');
  });

  // ---- 2. 정보입력 --------------------------------------------------------

  infoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(infoForm);
    const pin = infoForm.pin.value;
    const pinError = validatePin(pin, { phone: myPhone });
    if (pinError) return showFieldError(infoForm, 'pin', pinError);
    if (pin !== infoForm.pinConfirm.value) return showFieldError(infoForm, 'pinConfirm', '계좌 비밀번호가 일치하지 않습니다.');
    const nickname = infoForm.nickname.value.trim();
    if (nickname.length > 50) return showFieldError(infoForm, 'nickname', '계좌 별명은 50자 이내로 입력해 주세요.');

    draft = { pin, nickname };
    // 확인 단계로 넘어가는 시점에 키를 만들고 본문을 고정한다.
    tx = api.newOpenAccount({ pin, termsVersion: checkingTerms.version });
    document.getElementById('confirm-terms').textContent = `입출금통장 약관 ${checkingTerms.version} 동의`;
    document.getElementById('confirm-nickname').textContent = nickname || '없음';
    clearErrors(confirmSection);
    showStep('confirm');
    openButton.focus();
  });

  // ---- 3. 확인 → 개설 -----------------------------------------------------

  function lock(locked) {
    setDisabled([confirmBack], locked);
    uncertainBox.hidden = !locked;
    guardUnload(locked);
    openButton.textContent = locked ? '같은 내용으로 다시 시도' : '계좌 개설';
  }

  openButton.addEventListener('click', async () => {
    if (!tx) return;
    clearErrors(confirmSection);
    setBusy(openButton, true, '개설 중…');
    let res;
    try {
      res = await tx.submit(); // 201 { accountId, number, balance, openedAt }
    } catch (err) {
      setBusy(openButton, false);
      if (err.uncertain) {
        lock(true);
        return;
      }
      lock(false);
      tx = null;
      if (err.code === 'TERMS_VERSION_REQUIRED') {
        showStep('terms');
        showFormError(termsForm, '약관이 바뀌었습니다. 다시 불러온 약관을 확인하고 동의해 주세요.');
        loadTerms();
        return;
      }
      if (err.code === 'BANKING_SETUP_REQUIRED') document.getElementById('setup-required').hidden = false;
      // 거절이면 키는 폐기됐다. 정보입력으로 돌아가 다시 확인받는다.
      showStep('info');
      showApiError(infoForm, err, {
        WEAK_CREDENTIAL: { field: 'pin', message: '반복·연속 숫자나 휴대폰 번호에 든 숫자는 계좌 비밀번호로 쓸 수 없습니다.' },
      });
      return;
    }
    setBusy(openButton, false);
    lock(false);
    tx = null;
    infoForm.pin.value = '';
    infoForm.pinConfirm.value = '';
    await showDone(res);
  });

  // ---- 4. 완료 ------------------------------------------------------------

  async function showDone(res) {
    const nickname = draft.nickname;
    draft = null;
    document.getElementById('result-number').textContent = res.number;
    document.getElementById('result-balance').textContent = formatAmount(res.balance);
    document.getElementById('result-opened').textContent = formatDateTime(res.openedAt);
    document.getElementById('result-alias').textContent = nickname ? '저장 중…' : '없음';
    document.getElementById('result-manage').href = manageLink(res.accountId);
    document.getElementById('result-history').href = transactionsLink(res.accountId);
    document.getElementById('result-deposit').href = depositLink(res.accountId);
    showStep('done');
    if (!nickname) return;

    // 별명 저장은 개설과 별개다. 최신 version을 읽어 PATCH한다.
    try {
      const prefs = await api.getPreferences(res.accountId);
      const saved = await api.updatePreferences(res.accountId, { version: prefs.version, alias: nickname });
      document.getElementById('result-alias').textContent = saved.alias ?? nickname;
    } catch (err) {
      if (err.handled) return;
      document.getElementById('result-alias').textContent = '저장 실패';
      document.getElementById('alias-failed').hidden = false;
    }
  }

  showStep('terms');
  loadTerms();
  loadMe();
}
