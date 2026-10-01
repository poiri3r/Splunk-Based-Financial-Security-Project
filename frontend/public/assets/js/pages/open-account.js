// 계좌개설: 약관동의 → 상품선택 → 정보입력 → 확인 → 완료.
//
// 백엔드 POST /api/accounts는 아직 요청 본문을 받지 않는다(옵션 필드 추가는 백엔드 요청 사항).
// 그래서 옵션은 화면에서 입력·검증만 하고, 개설 요청은 지금처럼 본문 없이 보낸다.
// 백엔드가 필드를 정하면 buildRequest()의 결과를 api.openAccount()에 넘기도록 바꾼다.
import { api, isUncertain } from '../api.js';
import { requireAuth } from '../session.js';
import { formatAmount } from '../format.js';
import { clearErrors, showFieldError, showFormError, showApiError, setBusy, transactionsLink, depositLink } from '../ui.js';
import { ROUTES } from '../routes.js';
import { validatePin } from '../validate.js';

const PRODUCTS = {
  free: 'Project 자유입출금 통장',
  salary: 'Project 급여 통장',
  youth: 'Project 청년 통장',
};

if (requireAuth()) init();

function init() {
  const steps = Object.fromEntries(
    [...document.querySelectorAll('[data-step]')].map((node) => [node.dataset.step, node]),
  );
  const stepLabels = document.querySelectorAll('[data-step-label]');
  const termsForm = document.getElementById('terms-form');
  const productForm = document.getElementById('product-form');
  const infoForm = document.getElementById('info-form');
  const confirmSection = document.getElementById('confirm-section');
  const openButton = document.getElementById('open-account');
  const confirmBack = document.getElementById('confirm-back');

  let draft = null; // 확인 단계에서 고정한 입력값

  function showStep(name) {
    for (const [key, node] of Object.entries(steps)) node.hidden = key !== name;
    stepLabels.forEach((li) => li.classList.toggle('active', li.dataset.stepLabel === name));
    steps[name].querySelector('h2')?.scrollIntoView({ block: 'nearest' });
  }

  document.querySelectorAll('[data-back]').forEach((button) => {
    button.addEventListener('click', () => showStep(button.dataset.back));
  });

  // ---- 1. 약관동의 --------------------------------------------------------

  const agreeAll = document.getElementById('agree-all');
  const agreeBoxes = [...termsForm.querySelectorAll('input[name="agree"]')];
  agreeAll.addEventListener('change', () => agreeBoxes.forEach((box) => { box.checked = agreeAll.checked; }));
  agreeBoxes.forEach((box) => box.addEventListener('change', () => {
    agreeAll.checked = agreeBoxes.every((b) => b.checked);
  }));

  termsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(termsForm);
    if (agreeBoxes.some((box) => box.required && !box.checked)) {
      return showFormError(termsForm, '필수 약관에 모두 동의해 주세요.');
    }
    showStep('product');
  });

  // ---- 2. 상품선택 --------------------------------------------------------

  productForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(productForm);
    if (!PRODUCTS[productForm.product.value]) return showFormError(productForm, '상품을 선택해 주세요.');
    showStep('info');
  });

  // ---- 3. 정보입력 --------------------------------------------------------

  const label = (select) => select.selectedOptions[0]?.textContent ?? '';

  infoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors(infoForm);
    const f = infoForm;
    if (!f.purpose.value) return showFieldError(f, 'purpose', '거래 목적을 선택해 주세요.');
    if (!f.fundSource.value) return showFieldError(f, 'fundSource', '자금 출처를 선택해 주세요.');
    const nickname = f.nickname.value.trim();
    if (nickname.length > 20) return showFieldError(f, 'nickname', '계좌 별칭은 20자 이내로 입력해 주세요.');
    const pinError = validatePin(f.pin.value);
    if (pinError) return showFieldError(f, 'pin', pinError);
    if (f.pin.value !== f.pinConfirm.value) return showFieldError(f, 'pinConfirm', '계좌 비밀번호가 일치하지 않습니다.');

    draft = {
      product: productForm.product.value,
      purpose: f.purpose.value,
      fundSource: f.fundSource.value,
      nickname,
      alert: f.alert.checked,
      marketing: termsForm.querySelector('input[value="marketing"]').checked,
      pin: f.pin.value,
    };
    document.getElementById('confirm-product').textContent = PRODUCTS[draft.product];
    document.getElementById('confirm-purpose').textContent = label(f.purpose);
    document.getElementById('confirm-source').textContent = label(f.fundSource);
    document.getElementById('confirm-nickname').textContent = nickname || '없음';
    document.getElementById('confirm-alert').textContent = draft.alert ? '받음' : '받지 않음';
    clearErrors(confirmSection);
    showStep('confirm');
    openButton.focus();
  });

  // ---- 4. 확인 → 개설 -----------------------------------------------------

  // 백엔드에 보낼 본문(필드 이름은 백엔드 확정 전 가안). 현재는 쓰지 않는다.
  function buildRequest(d) {
    return {
      productType: d.product, purpose: d.purpose, fundSource: d.fundSource,
      nickname: d.nickname || null, notification: d.alert, marketingConsent: d.marketing, accountPin: d.pin,
    };
  }

  // 계좌 개설은 멱등하지 않으므로 자동 재시도하지 않는다.
  openButton.addEventListener('click', async () => {
    if (!draft) return;
    clearErrors(confirmSection);
    setBusy(openButton, true, '개설 중…');
    confirmBack.disabled = true;
    let res;
    try {
      res = await api.openAccount();
    } catch (err) {
      if (isUncertain(err)) {
        showFormError(confirmSection, '계좌 개설 결과를 확인하지 못했습니다. 전체계좌조회에서 개설 여부를 확인한 뒤 다시 시도해 주세요.');
      } else {
        showApiError(confirmSection, err);
      }
      return;
    } finally {
      setBusy(openButton, false);
      confirmBack.disabled = false;
    }

    // 개설이 끝나면 비밀번호 입력값을 지우고, 뒤로 가서 다시 개설하지 못하게 한다.
    infoForm.pin.value = '';
    infoForm.pinConfirm.value = '';
    const product = PRODUCTS[draft.product];
    draft = null;

    document.getElementById('result-product').textContent = product;
    if (res && typeof res.number === 'string') {
      document.getElementById('result-number').textContent = res.number;
      document.getElementById('result-balance').textContent = formatAmount(res.balance);
      document.getElementById('result-history').href = transactionsLink(res.number);
      document.getElementById('result-deposit').href = depositLink(res.number);
    } else {
      // 계약상 번호가 와야 한다. 없으면 목록에서 확인하도록 안내한다.
      console.error('[open-account] 계좌 개설 응답 형식이 계약과 다릅니다.', res);
      document.getElementById('result-number').textContent = '전체계좌조회에서 확인해 주세요';
      document.getElementById('result-balance').textContent = '-';
      document.getElementById('result-history').href = ROUTES.accounts;
    }
    showStep('done');
  });

  showStep('terms');
}
