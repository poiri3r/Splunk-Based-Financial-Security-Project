// 비밀번호 재설정 (작업 요청서 R3·A7): 계좌 증명 또는 복구 코드 → 5분짜리 resetToken → 새 비밀번호.
// resetToken은 목적(PASSWORD)·사용자에 묶인 일회용 값이다. 메모리에만 두고, 새로고침하면 증명부터 다시 한다.
// 성공하면 서버가 현재 토큰을 포함한 모든 로그인을 폐기한다. 자동으로 로그인 상태를 만들지 않는다.
import { api } from '../api.js';
import { getToken, clearSession } from '../session.js';
import { validatePassword } from '../validate.js';
import { formatRemaining } from '../format.js';
import { clearErrors, showFieldError, showFormError, showApiError, setBusy } from '../ui.js';
import { setupProof, readProof, clearProofSecrets, showProofError } from '../recovery-proof.js';
import { ROUTES } from '../routes.js';

if (getToken()) location.replace(ROUTES.home);

const verifyForm = document.getElementById('verify-form');
const resetForm = document.getElementById('reset-form');
const timerNode = document.getElementById('reset-timer');
let grant = null; // { token, expiresAt(ms) }
let timer = null;

setupProof(verifyForm);

function showStep(name) {
  document.querySelectorAll('[data-step]').forEach((n) => { n.hidden = n.dataset.step !== name; });
  document.querySelectorAll('[data-step-label]').forEach((li) => li.classList.toggle('active', li.dataset.stepLabel === name));
}

// 권한이 만료·무효가 되면 증명부터 다시 한다.
function restart(message) {
  grant = null;
  clearInterval(timer);
  resetForm.reset();
  showStep('verify');
  showFormError(verifyForm, message);
}

function renderTimer() {
  const left = grant.expiresAt - Date.now();
  if (left <= 0) return restart('본인 확인 유효 시간(5분)이 지났습니다. 다시 확인해 주세요.');
  timerNode.textContent = `본인 확인 완료 · ${formatRemaining(left)} 안에 변경해 주세요.`;
}

verifyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(verifyForm);
  const proof = readProof(verifyForm, 'PASSWORD');
  if (!proof) return;

  const button = verifyForm.querySelector('button[type="submit"]');
  setBusy(button, true, '확인 중…');
  try {
    const res = await api.verifyRecovery(proof); // { resetToken, expiresAt, purpose }
    clearProofSecrets(verifyForm);
    grant = { token: res.resetToken, expiresAt: Date.parse(res.expiresAt) };
    clearInterval(timer);
    timer = setInterval(renderTimer, 1000);
    renderTimer();
    showStep('reset');
    resetForm.newPassword.focus();
  } catch (err) {
    showProofError(verifyForm, err);
  } finally {
    setBusy(button, false);
  }
});

resetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(resetForm);
  if (!grant) return restart('본인 확인부터 다시 진행해 주세요.');
  const newPassword = resetForm.newPassword.value;
  const passwordError = validatePassword(newPassword);
  if (passwordError) return showFieldError(resetForm, 'newPassword', passwordError);
  if (newPassword !== resetForm.newPasswordConfirm.value) {
    return showFieldError(resetForm, 'newPasswordConfirm', '비밀번호가 일치하지 않습니다.');
  }

  const button = resetForm.querySelector('button[type="submit"]');
  setBusy(button, true, '변경 중…');
  try {
    await api.resetPassword(grant.token, newPassword); // 204
    grant = null;
    clearInterval(timer);
    resetForm.reset();
    clearSession(); // 이 브라우저에 남은 토큰이 있다면 이미 서버에서 폐기됐다
    showStep('done');
  } catch (err) {
    if (err.code === 'RECOVERY_INVALID') {
      // 만료·재사용·다른 목적의 권한. 증명부터 다시 한다.
      restart('본인 확인이 만료되었거나 이미 사용되었습니다. 처음부터 다시 진행해 주세요.');
      return;
    }
    showApiError(resetForm, err, {
      WEAK_CREDENTIAL: { field: 'newPassword', message: '이전과 같은 비밀번호이거나 규칙에 맞지 않는 비밀번호입니다.' },
      RATE_LIMITED: { message: '요청이 너무 많습니다. 잠시 후(최대 1시간) 다시 시도해 주세요.' },
    });
  } finally {
    setBusy(button, false);
  }
});

showStep('verify');
