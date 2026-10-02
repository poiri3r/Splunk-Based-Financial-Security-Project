// 비밀번호 재설정: 본인 확인 → 재설정 토큰 → 새 비밀번호 (2단계 가안, docs/backend_request.docx 3-3)
// 재설정 토큰은 메모리에만 둔다. 새로고침하면 본인 확인부터 다시 한다.
import { api } from '../api.js';
import { getToken } from '../session.js';
import { validateUsername, validatePassword, validateName, validatePhone, normalizePhone } from '../validate.js';
import { clearErrors, showFieldError, showFormError, showApiError, setBusy } from '../ui.js';
import { ROUTES } from '../routes.js';

if (getToken()) location.replace(ROUTES.home);

const verifyForm = document.getElementById('verify-form');
const resetForm = document.getElementById('reset-form');
let resetToken = null;

function showStep(name) {
  document.querySelectorAll('[data-step]').forEach((n) => { n.hidden = n.dataset.step !== name; });
  document.querySelectorAll('[data-step-label]').forEach((li) => li.classList.toggle('active', li.dataset.stepLabel === name));
}

verifyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(verifyForm);
  const username = verifyForm.username.value.trim();
  const name = verifyForm.elements.namedItem('name').value.trim();
  const phone = normalizePhone(verifyForm.phone.value);
  const usernameError = validateUsername(username);
  if (usernameError) return showFieldError(verifyForm, 'username', usernameError);
  const nameError = validateName(name);
  if (nameError) return showFieldError(verifyForm, 'name', nameError);
  const phoneError = validatePhone(phone);
  if (phoneError) return showFieldError(verifyForm, 'phone', phoneError);

  const button = verifyForm.querySelector('button[type="submit"]');
  setBusy(button, true, '확인 중…');
  try {
    const res = await api.verifyPasswordReset(username, name, phone);
    resetToken = res.resetToken;
    showStep('reset');
    resetForm.newPassword.focus();
  } catch (err) {
    showApiError(verifyForm, err, {
      USER_NOT_FOUND: { message: '입력한 정보와 일치하는 회원이 없습니다.' },
    });
  } finally {
    setBusy(button, false);
  }
});

resetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(resetForm);
  const newPassword = resetForm.newPassword.value;
  const passwordError = validatePassword(newPassword);
  if (passwordError) return showFieldError(resetForm, 'newPassword', passwordError);
  if (newPassword !== resetForm.newPasswordConfirm.value) {
    return showFieldError(resetForm, 'newPasswordConfirm', '비밀번호가 일치하지 않습니다.');
  }

  const button = resetForm.querySelector('button[type="submit"]');
  setBusy(button, true, '변경 중…');
  try {
    await api.resetPassword(resetToken, newPassword); // 204
    resetToken = null;
    resetForm.reset();
    showStep('done');
  } catch (err) {
    if (err.code === 'RESET_TOKEN_INVALID') {
      // 토큰이 만료됐거나 이미 쓰였다. 본인 확인부터 다시 한다.
      resetToken = null;
      resetForm.reset();
      showStep('verify');
      showFormError(verifyForm, err.message);
      return;
    }
    showApiError(resetForm, err);
  } finally {
    setBusy(button, false);
  }
});

showStep('verify');
