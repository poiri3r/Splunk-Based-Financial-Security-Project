// 복구 코드 발급·잔여 개수 (작업 요청서 A7 보완).
// - GET /me/recovery-codes → { remaining }. 지난 코드의 원문을 다시 보여 주는 API는 없다.
// - POST /me/recovery-codes { currentPassword } → { codes: [5개], oneTimeDisplay: true }. 재발급하면 이전 코드는 폐기된다.
// - 코드 원문은 화면에 한 번만 그린다. URL·콘솔·localStorage/sessionStorage에 남기지 않는다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { clearErrors, showFieldError, showApiError, setBusy, el } from '../ui.js';

if (requireAuth()) init();

function init() {
  const section = document.getElementById('rc-section');
  const form = document.getElementById('rc-form');
  const result = document.getElementById('rc-result');
  const codeList = document.getElementById('rc-codes');

  async function loadStatus() {
    try {
      const { remaining } = await api.recoveryCodeStatus();
      document.getElementById('rc-remaining').textContent = String(remaining);
    } catch (err) {
      showApiError(section, err);
    }
  }

  function hideCodes() {
    codeList.replaceChildren();
    result.hidden = true;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const currentPassword = form.currentPassword.value;
    if (!currentPassword) return showFieldError(form, 'currentPassword', '현재 비밀번호를 입력해 주세요.');
    if (!window.confirm('새로 발급하면 이전 복구 코드는 모두 쓸 수 없게 됩니다. 계속할까요?')) return;

    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true, '발급 중…');
    try {
      const { codes } = await api.issueRecoveryCodes(currentPassword);
      form.reset();
      codeList.replaceChildren(...codes.map((code) => el('li', { className: 'mono', textContent: code })));
      result.hidden = false;
      await loadStatus();
    } catch (err) {
      form.currentPassword.value = '';
      showApiError(form, err, {
        REAUTHENTICATION_FAILED: { field: 'currentPassword', message: '현재 비밀번호가 올바르지 않습니다.' },
        RATE_LIMITED: { message: '비밀번호 확인 요청이 너무 많습니다. 5분 뒤 다시 시도해 주세요.' },
      });
    } finally {
      setBusy(button, false);
    }
  });

  document.getElementById('rc-hide').addEventListener('click', hideCodes);
  // 다른 화면으로 갔다가 뒤로 와도 브라우저 캐시(bfcache)에 원문이 남지 않게 한다.
  window.addEventListener('pagehide', hideCodes);
  loadStatus();
}
