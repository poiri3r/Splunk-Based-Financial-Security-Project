// 모의 휴대폰 확인: 인증번호 요청 → 6자리 입력 → contactGrant 발급 (작업 요청서 R1·R6·A5, 추가 협의 C1).
// 가입(REGISTER, 공개), 연락처 변경·계좌 비밀번호 재설정(PROFILE, 로그인 필요)에서 같이 쓴다.
//
// - 실제 문자는 발송되지 않는다. 화면에는 "모의 연락처 확인"으로 안내한다.
// - C1 A안(개발자 수동 확인): 인증번호는 시연 담당자가 서버 전용 키로 모의 수신함 API를 조회해 전달한다.
//   그 키는 브라우저 코드·config.js·저장소 어디에도 넣지 않는다. 목 모드에서는 MOCK 패널이 번호를 보여 준다.
// - challengeId·contactGrant는 이 모듈의 메모리에만 둔다. 번호를 바꾸면 확인을 처음부터 다시 받는다.
// - 인증번호·확인 권한은 각각 5분 유효. 번호 5회 오류 시 그 요청은 잠긴다(CHALLENGE_LOCKED).
//
// HTML(scope 안): input[name=phone], [data-cv-request], [data-cv-code-field] 안의 input[name=code], [data-cv-verify], [data-cv-status]

import { api } from './api.js';
import { normalizePhone, validatePhone } from './validate.js';
import { formatRemaining } from './format.js';
import { clearErrors, showFieldError, showFormError, showApiError, setBusy } from './ui.js';

const MSG_DELIVERY_DISABLED = '이 서버는 연락처 인증 발송이 꺼져 있습니다(503 DELIVERY_DISABLED). '
  + '백엔드를 demo-verification 프로필로 실행해야 확인할 수 있습니다. 확인 없이 진행할 수는 없습니다.';

// purpose: 'REGISTER' | 'PROFILE'. fixedPhone이 있으면 그 번호만 확인한다(계좌 비밀번호 재설정: 현재 등록 번호).
export function setupContactVerify(scope, { purpose, fixedPhone = null, onChange = () => {} }) {
  const phoneInput = scope.querySelector('input[name="phone"]');
  const requestButton = scope.querySelector('[data-cv-request]');
  const codeField = scope.querySelector('[data-cv-code-field]');
  const codeInput = scope.querySelector('input[name="code"]');
  const verifyButton = scope.querySelector('[data-cv-verify]');
  const status = scope.querySelector('[data-cv-status]');

  let challenge = null; // { id, expiresAt(ms), contact }
  let grant = null; // { token, expiresAt(ms), contact }
  let timer = null;

  if (fixedPhone) {
    phoneInput.value = fixedPhone;
    phoneInput.readOnly = true;
  }

  function render() {
    const now = Date.now();
    if (grant) {
      const left = grant.expiresAt - now;
      if (left <= 0) {
        reset('확인 유효 시간이 지났습니다. 인증번호를 다시 요청해 주세요.');
        return;
      }
      status.textContent = `모의 확인 완료 · ${formatRemaining(left)} 안에 진행해 주세요.`;
      return;
    }
    if (challenge) {
      const left = challenge.expiresAt - now;
      status.textContent = left > 0
        ? `인증번호 유효 시간 ${formatRemaining(left)}`
        : '인증번호 유효 시간이 지났습니다. 다시 요청해 주세요.';
    }
  }

  function startTimer() {
    clearInterval(timer);
    timer = setInterval(render, 1000);
    render();
  }

  // 번호 변경·만료·잠금: 진행 중인 확인을 모두 버린다.
  function reset(message = '') {
    challenge = null;
    grant = null;
    clearInterval(timer);
    codeInput.value = '';
    codeInput.disabled = false;
    verifyButton.disabled = false;
    codeField.hidden = true;
    requestButton.textContent = '인증번호 요청';
    status.textContent = message;
    if (message) codeField.hidden = false;
    onChange(null);
  }

  phoneInput.addEventListener('input', () => { if (challenge || grant) reset(); });

  requestButton.addEventListener('click', async () => {
    clearErrors(scope);
    const contact = normalizePhone(phoneInput.value);
    const phoneError = validatePhone(contact);
    if (phoneError) return showFieldError(scope, 'phone', phoneError);

    setBusy(requestButton, true, '요청 중…');
    try {
      const res = await api.startChallenge(purpose, contact); // 202 { challengeId, expiresAt, delivery, inboxToken }
      grant = null;
      challenge = { id: res.challengeId, expiresAt: Date.parse(res.expiresAt), contact };
      codeField.hidden = false;
      codeInput.value = '';
      codeInput.disabled = false;
      verifyButton.disabled = false;
      codeInput.focus();
      startTimer();
      onChange(null);
    } catch (err) {
      if (err.code === 'DELIVERY_DISABLED') return showFormError(scope, MSG_DELIVERY_DISABLED);
      showApiError(scope, err, {
        INVALID_INPUT: { field: 'phone', message: '휴대폰 번호 형식을 확인해 주세요.' },
        RATE_LIMITED: { field: 'phone', message: '같은 번호는 1분에 한 번만 요청할 수 있습니다. 잠시 후 다시 요청해 주세요.' },
      });
    } finally {
      setBusy(requestButton, false);
      if (challenge) requestButton.textContent = '다시 요청';
    }
  });

  verifyButton.addEventListener('click', async () => {
    clearErrors(scope);
    if (!challenge) return showFieldError(scope, 'code', '먼저 인증번호를 요청해 주세요.');
    const code = codeInput.value.trim();
    if (!/^\d{6}$/.test(code)) return showFieldError(scope, 'code', '인증번호 6자리를 입력해 주세요.');

    setBusy(verifyButton, true, '확인 중…');
    try {
      const res = await api.verifyChallenge(purpose, challenge.id, code); // { contactGrant, expiresAt, assurance }
      grant = { token: res.contactGrant, expiresAt: Date.parse(res.expiresAt), contact: challenge.contact };
      challenge = null;
      codeInput.disabled = true;
      setBusy(verifyButton, false);
      verifyButton.disabled = true;
      render();
      onChange(grant.token);
    } catch (err) {
      setBusy(verifyButton, false);
      switch (err.code) {
        case 'CODE_INVALID':
          showFieldError(scope, 'code', '인증번호가 올바르지 않습니다. 5번 틀리면 다시 요청해야 합니다.');
          return;
        case 'CHALLENGE_LOCKED':
          reset();
          showFieldError(scope, 'phone', '인증번호를 5번 틀려 이 요청이 잠겼습니다. 인증번호를 다시 요청해 주세요.');
          return;
        case 'CHALLENGE_INVALID':
          reset();
          showFieldError(scope, 'phone', '인증 요청이 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요.');
          return;
        default:
          showApiError(scope, err);
      }
    }
  });

  return {
    // 아직 유효한 확인 권한. 없거나 만료됐으면 null.
    grant: () => (grant && grant.expiresAt > Date.now() ? grant.token : null),
    contact: () => grant?.contact ?? null,
    // 서버가 권한을 거부했을 때(CONTACT_GRANT_INVALID 등) 처음부터 다시 받게 한다.
    reset,
    // 결과 불명 중에는 번호·인증 입력을 잠근다.
    lock(locked) {
      phoneInput.readOnly = locked || Boolean(fixedPhone);
      requestButton.disabled = locked;
    },
  };
}
