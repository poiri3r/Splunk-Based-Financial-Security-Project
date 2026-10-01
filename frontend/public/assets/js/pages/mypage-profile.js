// 내 정보 조회·변경. 변경 가능한 항목은 휴대폰 번호만 둔다(가안 10.02 합의 사항 3-6).
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { validatePhone, normalizePhone } from '../validate.js';
import { formatDateTime, formatPhone } from '../format.js';
import { clearErrors, showFieldError, showApiError, setBusy } from '../ui.js';

if (requireAuth()) init();

function init() {
  const section = document.getElementById('profile-section');
  const form = document.getElementById('phone-form');
  const done = document.getElementById('phone-done');

  function render(me) {
    document.getElementById('me-username').textContent = me.username;
    document.getElementById('me-name').textContent = me.name ?? '-';
    document.getElementById('me-phone').textContent = formatPhone(me.phone) || '-';
    document.getElementById('me-created').textContent = me.createdAt ? formatDateTime(me.createdAt) : '-';
    document.getElementById('profile-info').hidden = false;
    form.hidden = false;
  }

  async function load() {
    try {
      render(await api.getMe());
    } catch (err) {
      showApiError(section, err);
    } finally {
      document.getElementById('profile-loading').hidden = true;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    done.hidden = true;
    const phone = normalizePhone(form.phone.value);
    const phoneError = validatePhone(phone);
    if (phoneError) return showFieldError(form, 'phone', phoneError);
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true, '변경 중…');
    try {
      render(await api.updateMe({ phone }));
      form.reset();
      done.hidden = false;
    } catch (err) {
      showApiError(form, err);
    } finally {
      setBusy(button, false);
    }
  });

  load();
}
