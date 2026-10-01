// 비밀번호 변경. 현재 비밀번호 불일치는 400 PASSWORD_MISMATCH다.
// (401로 오면 api.js가 세션 만료로 보고 로그아웃시키므로, 백엔드에 400을 요청했다)
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { validatePassword } from '../validate.js';
import { clearErrors, showFieldError, showApiError, setBusy } from '../ui.js';

if (requireAuth()) init();

function init() {
  const form = document.getElementById('password-form');
  const done = document.getElementById('password-done');
  const button = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    done.hidden = true;
    const currentPassword = form.currentPassword.value;
    const newPassword = form.newPassword.value;
    if (!currentPassword) return showFieldError(form, 'currentPassword', '현재 비밀번호를 입력해 주세요.');
    const passwordError = validatePassword(newPassword);
    if (passwordError) return showFieldError(form, 'newPassword', passwordError);
    if (newPassword === currentPassword) {
      return showFieldError(form, 'newPassword', '현재 비밀번호와 다른 비밀번호를 입력해 주세요.');
    }
    if (newPassword !== form.newPasswordConfirm.value) {
      return showFieldError(form, 'newPasswordConfirm', '비밀번호가 일치하지 않습니다.');
    }

    setBusy(button, true, '변경 중…');
    try {
      await api.changePassword(currentPassword, newPassword); // 204
      form.reset();
      done.hidden = false;
    } catch (err) {
      showApiError(form, err, {
        PASSWORD_MISMATCH: { field: 'currentPassword', message: '현재 비밀번호가 일치하지 않습니다.' },
      });
    } finally {
      setBusy(button, false);
    }
  });
}
