// 로그인 (작업 요청서 A2). 응답 형식 {token, tokenType, expiresIn}은 v4와 같다.
// 실패: 1~2회 401 LOGIN_FAILED, 3회째 423 LOGIN_LOCKED. 잠기면 정답을 넣어도 풀리지 않고 /login-unlock 절차가 필요하다.
import { api } from '../api.js';
import { getToken, saveSession, safeNext } from '../session.js';
import { clearErrors, showFieldError, showFormError, showApiError, setBusy, MSG_GENERAL } from '../ui.js';

// 로그인 후 원래 가려던 페이지로 돌아간다. next가 없거나 허용되지 않는 값이면 홈.
const params = new URLSearchParams(location.search);
const next = safeNext(params.get('next'));

if (getToken()) location.replace(next);

const form = document.getElementById('login-form');
const submit = form.querySelector('button[type="submit"]');
const lockedBox = document.getElementById('locked-box');

if (params.get('registered') === '1') document.getElementById('registered-notice').hidden = false;
if (params.get('relogin') === '1') document.getElementById('relogin-notice').hidden = false;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(form);
  lockedBox.hidden = true;
  const username = form.username.value.trim();
  const password = form.password.value;

  if (!username) return showFieldError(form, 'username', '아이디를 입력해 주세요.');
  if (!password) return showFieldError(form, 'password', '비밀번호를 입력해 주세요.');

  setBusy(submit, true, '로그인 중…');
  try {
    const res = await api.login(username, password);
    if (!res || typeof res.token !== 'string' || typeof res.expiresIn !== 'number') {
      // 계약: token은 문자열(JWT 아님), expiresIn은 숫자(초)
      console.error('[login] 로그인 응답 형식이 계약과 다릅니다.');
      showFormError(form, MSG_GENERAL);
      return;
    }
    saveSession(res.token, res.expiresIn, username);
    location.replace(next);
  } catch (err) {
    // 토큰 없는 요청이므로 api.js는 401을 세션 만료로 처리하지 않는다.
    if (err.code === 'LOGIN_LOCKED') {
      lockedBox.hidden = false;
    } else {
      showApiError(form, err, {
        LOGIN_FAILED: { message: '아이디 또는 비밀번호가 일치하지 않습니다. 3번 틀리면 로그인이 잠깁니다.' },
        RATE_LIMITED: { message: '로그인 요청이 너무 많습니다. 1분 뒤 다시 시도해 주세요.' },
      });
    }
    form.password.value = '';
  } finally {
    setBusy(submit, false);
  }
});
