// 계좌 비밀번호 분실·잠금 재설정 (작업 요청서 A5·A7, 흐름도 F8). ?account=<계좌 UUID>
// POST /api/v2/accounts/{id}/pin/reset { currentPassword, newPin, contactGrant | recoveryCode } → 204
// - 증명은 둘 중 정확히 하나: 현재 등록된 휴대폰의 PROFILE/SMS 모의 확인, 또는 복구 코드. 다른 번호의 확인 권한은 거부된다.
// - 성공하면 서버가 모든 로그인·승인 권한·복구 코드를 폐기한다. 로컬 세션을 정리하고 재로그인을 안내한다.
// - 복구 코드·확인 권한은 소비될 수 있으므로 자동 재시도하지 않는다.
import { api } from '../api.js';
import { requireAuth, endSessionLocally } from '../session.js';
import { validatePin } from '../validate.js';
import { formatPhone } from '../format.js';
import { clearErrors, showFieldError, showFormError, showApiError, setBusy, el, accountLabel, isDebitCandidate } from '../ui.js';
import { setupContactVerify } from '../contact-verify.js';

if (requireAuth()) init();

function init() {
  const form = document.getElementById('pin-reset-form');
  const accountSelect = form.accountId;
  let accounts = [];
  let me = null;
  let verifier = null;

  const method = () => form.querySelector('input[name="method"]:checked').value;
  function syncMethod() {
    form.querySelectorAll('[data-method]').forEach((node) => { node.hidden = node.dataset.method !== method(); });
  }
  form.querySelectorAll('input[name="method"]').forEach((r) => r.addEventListener('change', syncMethod));

  function renderAccountState() {
    const a = accounts.find((x) => x.accountId === accountSelect.value);
    const p = a?.preferences;
    document.getElementById('pr-account-state').textContent = !p ? ''
      : p.pinLocked ? '현재 잠김 상태입니다.' : p.pinConfigured ? '비밀번호가 등록되어 있습니다.' : '아직 비밀번호가 없습니다.';
  }
  accountSelect.addEventListener('change', renderAccountState);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const accountId = accountSelect.value;
    if (!accountId) return showFieldError(form, 'accountId', '계좌를 선택해 주세요.');
    const payload = { currentPassword: form.currentPassword.value, newPin: form.newPin.value };
    if (method() === 'CONTACT') {
      const contactGrant = verifier?.grant();
      if (!contactGrant) return showFieldError(form, 'phone', '등록된 휴대폰의 모의 확인을 먼저 완료해 주세요.');
      payload.contactGrant = contactGrant;
    } else {
      const recoveryCode = form.recoveryCode.value.trim();
      if (!recoveryCode) return showFieldError(form, 'recoveryCode', '복구 코드를 입력해 주세요.');
      payload.recoveryCode = recoveryCode;
    }
    if (!payload.currentPassword) return showFieldError(form, 'currentPassword', '로그인 비밀번호를 입력해 주세요.');
    const pinError = validatePin(payload.newPin, { phone: me?.phone });
    if (pinError) return showFieldError(form, 'newPin', pinError);
    if (payload.newPin !== form.newPinConfirm.value) return showFieldError(form, 'newPinConfirm', '새 계좌 비밀번호가 일치하지 않습니다.');

    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true, '재설정 중…');
    try {
      await api.resetPin(accountId, payload); // 204
      form.reset();
      form.hidden = true;
      endSessionLocally();
      document.getElementById('pr-done').hidden = false;
    } catch (err) {
      form.currentPassword.value = '';
      if (err.code === 'RECOVERY_INVALID' || err.code === 'CONTACT_GRANT_INVALID') {
        verifier?.reset();
        form.recoveryCode.value = '';
        return showFormError(form, '본인 확인에 실패했습니다. 등록된 휴대폰으로 다시 확인하거나, 사용하지 않은 복구 코드를 입력해 주세요.');
      }
      showApiError(form, err, {
        REAUTHENTICATION_FAILED: { field: 'currentPassword', message: '로그인 비밀번호가 올바르지 않습니다.' },
        WEAK_CREDENTIAL: { field: 'newPin', message: '반복·연속 숫자나 휴대폰 번호에 든 숫자는 쓸 수 없습니다.' },
        PRODUCT_ACCOUNT_RESTRICTED: { field: 'accountId', message: '입출금 계좌만 계좌 비밀번호를 재설정할 수 있습니다.' },
        RATE_LIMITED: { message: '비밀번호 확인 요청이 너무 많습니다. 5분 뒤 다시 시도해 주세요.' },
      });
    } finally {
      setBusy(button, false);
    }
  });

  async function start() {
    try {
      const [list, profile] = await Promise.all([api.listAccounts({ includeHidden: true }), api.getMe()]);
      accounts = list.items.filter(isDebitCandidate);
      me = profile;
    } catch (err) {
      showApiError(form, err);
      form.hidden = false;
      return;
    } finally {
      document.getElementById('pr-loading').hidden = true;
    }
    if (accounts.length === 0) {
      form.hidden = false;
      showFormError(form, '재설정할 입출금 계좌가 없습니다.');
      return;
    }
    accountSelect.replaceChildren(...accounts.map((a) => el('option', { value: a.accountId, textContent: accountLabel(a) })));
    const preset = new URLSearchParams(location.search).get('account');
    if (preset && accounts.some((a) => a.accountId === preset)) accountSelect.value = preset;
    renderAccountState();

    // 휴대폰 확인은 현재 등록된 번호로만 할 수 있다(서버가 다른 번호의 권한을 거부한다).
    if (me.phone) {
      document.getElementById('pr-phone-label').textContent = `현재 등록된 번호 ${formatPhone(me.phone)}로 확인합니다`;
      verifier = setupContactVerify(form, { purpose: 'PROFILE', fixedPhone: me.phone });
    } else {
      form.querySelector('input[value="CONTACT"]').disabled = true;
      form.querySelector('input[value="RECOVERY_CODE"]').checked = true;
      document.getElementById('pr-phone-label').textContent = '등록된 휴대폰이 없어 사용할 수 없습니다';
    }
    syncMethod();
    form.hidden = false;
  }

  start();
}
