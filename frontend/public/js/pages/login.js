import { api } from '../api.js';
import { getToken, saveSession } from '../session.js';
import { clearErrors, showFieldError, showFormError, showApiError, setBusy, MSG_GENERAL } from '../ui.js';

if (getToken()) location.replace('accounts.html');

const form = document.getElementById('login-form');
const submit = form.querySelector('button[type="submit"]');

if (new URLSearchParams(location.search).get('registered') === '1') {
  document.getElementById('registered-notice').hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(form);
  const username = form.username.value.trim();
  const password = form.password.value;

  if (!username) return showFieldError(form, 'username', '아이디를 입력해 주세요.');
  if (!password) return showFieldError(form, 'password', '비밀번호를 입력해 주세요.');

  setBusy(submit, true, '로그인 중…');
  try {
    const res = await api.login(username, password);
    if (!res || typeof res.token !== 'string' || typeof res.expiresIn !== 'number') {
      // 계약: token은 문자열, expiresIn은 숫자(초)
      console.error('[login] 로그인 응답 형식이 계약과 다릅니다.', res);
      showFormError(form, MSG_GENERAL);
      return;
    }
    saveSession(res.token, res.expiresIn, username);
    location.replace('accounts.html');
  } catch (err) {
    // 로그인 실패도 401 UNAUTHORIZED다. 토큰 없는 요청이므로 api.js는 리다이렉트하지 않는다.
    showApiError(form, err, {
      UNAUTHORIZED: { message: '아이디 또는 비밀번호가 일치하지 않습니다.' },
    });
    form.password.value = '';
  } finally {
    setBusy(submit, false);
  }
});
