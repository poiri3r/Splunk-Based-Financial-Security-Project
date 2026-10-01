// 아이디 찾기: 이름 + 휴대폰 번호 (조건은 백엔드가 확정한다. 가안 10.02 합의 사항 3-2)
import { api } from '../api.js';
import { getToken } from '../session.js';
import { validateName, validatePhone, normalizePhone } from '../validate.js';
import { formatDateTime } from '../format.js';
import { clearErrors, showFieldError, showFormError, showApiError, setBusy } from '../ui.js';
import { ROUTES } from '../routes.js';

if (getToken()) location.replace(ROUTES.home);

const form = document.getElementById('find-id-form');
const submit = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(form);
  // form.name은 폼 자신의 name 속성이라 입력칸은 elements로 꺼낸다.
  const name = form.elements.namedItem('name').value.trim();
  const phone = normalizePhone(form.phone.value);
  const nameError = validateName(name);
  if (nameError) return showFieldError(form, 'name', nameError);
  const phoneError = validatePhone(phone);
  if (phoneError) return showFieldError(form, 'phone', phoneError);

  setBusy(submit, true, '확인 중…');
  try {
    const res = await api.findId(name, phone);
    document.getElementById('found-id').textContent = res.username;
    document.getElementById('found-since').textContent = res.createdAt ? `(가입일 ${formatDateTime(res.createdAt)})` : '';
    form.hidden = true;
    document.getElementById('find-id-result').hidden = false;
  } catch (err) {
    showApiError(form, err, {
      USER_NOT_FOUND: { message: '입력한 정보와 일치하는 회원이 없습니다.' },
    });
  } finally {
    setBusy(submit, false);
  }
});

