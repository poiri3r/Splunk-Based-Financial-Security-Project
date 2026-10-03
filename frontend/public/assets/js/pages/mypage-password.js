// 비밀번호 변경 (작업 요청서 R6·A2). PUT /api/v2/me/password → 204.
// - 현재 비밀번호 불일치는 401 REAUTHENTICATION_FAILED다. 세션은 유지되고 이 화면에서 다시 입력받는다.
// - 성공하면 서버가 현재 토큰을 포함한 모든 세션을 폐기한다. 다른 업무 요청 없이 로컬 세션만 정리하고 재로그인을 안내한다.
import { api } from '../api.js';
import { requireAuth, getUsername, endSessionLocally } from '../session.js';
import { validatePassword } from '../validate.js';
import { clearErrors, showFieldError, showApiError, setBusy } from '../ui.js';

if (requireAuth()) init();

function init() {
  const form = document.getElementById('password-form');
  const button = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const currentPassword = form.currentPassword.value;
    const newPassword = form.newPassword.value;
    if (!currentPassword) return showFieldError(form, 'currentPassword', '현재 비밀번호를 입력해 주세요.');
    const passwordError = validatePassword(newPassword, { username: getUsername() });
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
      form.hidden = true;
      endSessionLocally();
      document.getElementById('password-done').hidden = false;
    } catch (err) {
      form.currentPassword.value = '';
      showApiError(form, err, {
        REAUTHENTICATION_FAILED: { field: 'currentPassword', message: '현재 비밀번호가 올바르지 않습니다.' },
        WEAK_CREDENTIAL: { field: 'newPassword', message: '이전과 같거나 규칙에 맞지 않는 비밀번호입니다(반복·연속 문자, 아이디·휴대폰 번호 포함 불가).' },
        RATE_LIMITED: { message: '비밀번호 확인 요청이 너무 많습니다. 5분 뒤 다시 시도해 주세요.' },
      });
    } finally {
      setBusy(button, false);
    }
  });
}
