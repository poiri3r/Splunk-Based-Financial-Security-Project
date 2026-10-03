// 로그인 잠금 해제 (작업 요청서 A2·A7): 증명(purpose=LOGIN_UNLOCK) → resetToken → POST /recovery/login-unlock.
// PASSWORD 목적의 권한으로는 잠금을 풀 수 없다. 증명은 복구 코드를 소비할 수 있으므로 자동 재시도하지 않는다.
// 증명은 성공했는데 해제 요청만 실패하면, 권한이 유효한 5분 동안 같은 권한으로 해제만 다시 시도한다.
import { api } from '../api.js';
import { getToken, clearSession } from '../session.js';
import { formatRemaining } from '../format.js';
import { clearErrors, showFormError, showApiError, setBusy } from '../ui.js';
import { setupProof, readProof, clearProofSecrets, showProofError } from '../recovery-proof.js';
import { ROUTES } from '../routes.js';

if (getToken()) location.replace(ROUTES.home);

const form = document.getElementById('unlock-form');
const retryBox = document.getElementById('unlock-retry');
const retryButton = document.getElementById('unlock-again');
const timerNode = document.getElementById('unlock-timer');
let grant = null; // { token, expiresAt(ms) }
let timer = null;

setupProof(form);

function backToProof(message) {
  grant = null;
  clearInterval(timer);
  retryBox.hidden = true;
  form.hidden = false;
  showFormError(form, message);
}

function renderTimer() {
  const left = grant.expiresAt - Date.now();
  if (left <= 0) return backToProof('본인 확인 유효 시간(5분)이 지났습니다. 다시 확인해 주세요.');
  timerNode.textContent = `본인 확인은 완료되었습니다. ${formatRemaining(left)} 안에 다시 시도할 수 있습니다.`;
}

async function unlock() {
  clearErrors(retryBox);
  setBusy(retryButton, true, '해제 중…');
  try {
    await api.unlockLogin(grant.token); // 204
    grant = null;
    clearInterval(timer);
    clearSession();
    form.hidden = true;
    retryBox.hidden = true;
    document.getElementById('unlock-done').hidden = false;
  } catch (err) {
    if (err.code === 'RECOVERY_INVALID') {
      backToProof('본인 확인이 만료되었거나 이미 사용되었습니다. 처음부터 다시 진행해 주세요.');
      return;
    }
    form.hidden = true;
    retryBox.hidden = false;
    clearInterval(timer);
    timer = setInterval(renderTimer, 1000);
    renderTimer();
    showApiError(retryBox, err, { RATE_LIMITED: { message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' } });
  } finally {
    setBusy(retryButton, false);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(form);
  const proof = readProof(form, 'LOGIN_UNLOCK');
  if (!proof) return;

  const button = form.querySelector('button[type="submit"]');
  setBusy(button, true, '확인 중…');
  try {
    const res = await api.verifyRecovery(proof); // { resetToken, expiresAt, purpose }
    clearProofSecrets(form);
    grant = { token: res.resetToken, expiresAt: Date.parse(res.expiresAt) };
  } catch (err) {
    showProofError(form, err);
    return;
  } finally {
    setBusy(button, false);
  }
  await unlock();
});

retryButton.addEventListener('click', () => { if (grant) unlock(); });
