// 회원탈퇴. 비밀번호 재확인, 잔액이 남은 계좌·가입 중인 예적금이 있으면 서버가 거부한다(가안 10.02 합의 사항 3-6).
// 탈퇴는 되돌릴 수 없으므로 자동 재시도하지 않는다.
import { api, isUncertain } from '../api.js';
import { requireAuth, clearSession } from '../session.js';
import { clearErrors, showFieldError, showFormError, showApiError, setBusy } from '../ui.js';

if (requireAuth()) init();

function init() {
  const form = document.getElementById('withdraw-form');
  const button = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const password = form.password.value;
    if (!password) return showFieldError(form, 'password', '비밀번호를 입력해 주세요.');
    if (!form.confirm.checked) return showFieldError(form, 'confirm', '탈퇴 안내를 확인하고 동의해 주세요.');
    if (!window.confirm('정말 탈퇴하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;

    setBusy(button, true, '처리 중…');
    try {
      await api.withdraw(password); // 204
    } catch (err) {
      setBusy(button, false);
      if (isUncertain(err)) {
        return showFormError(form, '탈퇴 결과를 확인하지 못했습니다. 다시 로그인해 보고, 로그인이 되면 다시 시도해 주세요.');
      }
      return showApiError(form, err, {
        PASSWORD_MISMATCH: { field: 'password', message: '비밀번호가 일치하지 않습니다.' },
      });
    }
    clearSession();
    form.hidden = true;
    document.getElementById('withdraw-done').hidden = false;
    // 헤더의 로그인 표시를 비회원 상태로 바꾼다
    document.querySelectorAll('[data-when]').forEach((n) => { n.hidden = n.dataset.when === 'member'; });
  });
}
