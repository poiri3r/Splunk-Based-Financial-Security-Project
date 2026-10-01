import { api, isUncertain } from '../api.js';
import { getToken } from '../session.js';
import { validateUsername, validatePassword } from '../validate.js';
import { clearErrors, showFieldError, showFormError, showApiError, setBusy } from '../ui.js';
import { ROUTES } from '../routes.js';

if (getToken()) location.replace(ROUTES.home);

const form = document.getElementById('register-form');
const submit = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(form);
  const username = form.username.value.trim();
  const password = form.password.value;

  const usernameError = validateUsername(username);
  if (usernameError) return showFieldError(form, 'username', usernameError);
  const passwordError = validatePassword(password);
  if (passwordError) return showFieldError(form, 'password', passwordError);
  if (password !== form.passwordConfirm.value) {
    return showFieldError(form, 'passwordConfirm', '비밀번호가 일치하지 않습니다.');
  }

  // 회원가입은 멱등하지 않으므로 자동 재시도하지 않는다(api.register).
  setBusy(submit, true, '가입 중…');
  try {
    await api.register(username, password); // 201, 본문 없음
    location.replace(`${ROUTES.login}?registered=1`);
  } catch (err) {
    if (isUncertain(err)) {
      // 요청이 서버에서 처리됐을 수도 있다. 재시도하면 409가 떠 사용자를 오도하므로 확인을 안내한다.
      showFormError(form, '가입 결과를 확인하지 못했습니다. 먼저 로그인을 시도해 보고, 로그인이 안 되면 다시 가입해 주세요.');
      setBusy(submit, false);
      return;
    }
    showApiError(form, err, {
      DUPLICATE_USERNAME: { field: 'username', message: '이미 사용 중인 아이디입니다.' },
    });
    setBusy(submit, false);
  }
});
