// 내 정보 조회·변경 (작업 요청서 R6, 흐름도 F9).
// - 조회: GET /api/v2/auth/me. 모의 확인 여부는 phoneAssurance/emailAssurance(SIMULATED)로 보여 준다(phoneVerified는 항상 false).
// - 이름·이메일: PUT /me/profile. PUT은 통째로 바꾸므로 유지할 이름·전화번호를 함께 보낸다(생략·null이면 지워질 수 있음).
//   등록된 이름은 바꿀 수 없고, 이름이 없는 계정만 보완한다. 전화번호를 이 요청으로 바꾸면 CONTACT_CONFIRMATION_REQUIRED.
// - 휴대폰: PROFILE/SMS 모의 확인 → PUT /me/contact { currentPassword, contactGrant } → 204 → 다시 조회.
// - 현재 비밀번호 불일치는 401 REAUTHENTICATION_FAILED다. 로그아웃하지 않고 이 화면에 남는다(api.js가 code로 구분).
import { api } from '../api.js';
import { requireAuth, setDisplayName } from '../session.js';
import { validateName } from '../validate.js';
import { formatPhone } from '../format.js';
import { clearErrors, showFieldError, showApiError, setBusy } from '../ui.js';
import { setupContactVerify } from '../contact-verify.js';

const ASSURANCE_LABELS = { SIMULATED: '모의 확인', UNVERIFIED: '미확인' };

if (requireAuth()) init();

function init() {
  const section = document.getElementById('profile-section');
  const profileForm = document.getElementById('profile-form');
  const contactForm = document.getElementById('contact-form');
  let me = null;

  const verifier = setupContactVerify(contactForm, { purpose: 'PROFILE' });

  function render() {
    document.getElementById('me-username').textContent = me.username;
    document.getElementById('me-name').textContent = me.name ?? '미등록';
    document.getElementById('me-phone').textContent = me.phone ? formatPhone(me.phone) : '미등록';
    document.getElementById('me-phone-assurance').textContent = me.phone ? ASSURANCE_LABELS[me.phoneAssurance] ?? me.phoneAssurance : '';
    document.getElementById('me-email').textContent = me.email ?? '미등록';
    document.getElementById('me-email-assurance').textContent = me.email ? ASSURANCE_LABELS[me.emailAssurance] ?? me.emailAssurance : '';
    document.getElementById('banking-not-ready').hidden = me.bankingReady;
    document.getElementById('profile-info').hidden = false;

    document.getElementById('name-field').hidden = Boolean(me.name);
    profileForm.email.value = me.email ?? '';
    document.getElementById('profile-edit').hidden = false;
    document.getElementById('contact-edit').hidden = false;
  }

  async function load() {
    try {
      me = await api.getMe();
      render();
    } catch (err) {
      showApiError(section, err);
    } finally {
      document.getElementById('profile-loading').hidden = true;
    }
  }

  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(profileForm);
    document.getElementById('profile-done').hidden = true;
    let name = me.name;
    if (!name) {
      // form.name은 폼 자신의 name 속성이라 입력칸은 elements로 꺼낸다.
      name = profileForm.elements.namedItem('name').value.trim();
      const nameError = validateName(name);
      if (nameError) return showFieldError(profileForm, 'name', nameError);
    }
    const email = profileForm.email.value.trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showFieldError(profileForm, 'email', '이메일 형식을 확인해 주세요.');
    const currentPassword = profileForm.currentPassword.value;
    if (!currentPassword) return showFieldError(profileForm, 'currentPassword', '현재 비밀번호를 입력해 주세요.');

    const button = profileForm.querySelector('button[type="submit"]');
    setBusy(button, true, '저장 중…');
    try {
      me = await api.updateProfile({ currentPassword, version: me.version, name, email, phone: me.phone });
      setDisplayName(me.name); // 이름이 없던 계정이 이름을 보완한 경우 인사말도 바꾼다
      document.querySelectorAll('[data-username]').forEach((node) => { node.textContent = me.name || node.textContent; });
      profileForm.currentPassword.value = '';
      render();
      document.getElementById('profile-done').hidden = false;
    } catch (err) {
      profileForm.currentPassword.value = '';
      if (err.code === 'PROFILE_VERSION_CONFLICT') await load();
      showApiError(profileForm, err, {
        REAUTHENTICATION_FAILED: { field: 'currentPassword', message: '현재 비밀번호가 올바르지 않습니다.' },
        IDENTITY_CHANGE_NOT_ALLOWED: { message: '등록한 이름은 바꿀 수 없습니다.' },
        CONTACT_CONFIRMATION_REQUIRED: { message: '휴대폰 번호는 아래 휴대폰 번호 변경에서 모의 확인 후 바꿀 수 있습니다.' },
        RATE_LIMITED: { message: '비밀번호 확인 요청이 너무 많습니다. 5분 뒤 다시 시도해 주세요.' },
      });
    } finally {
      setBusy(button, false);
    }
  });

  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(contactForm);
    document.getElementById('contact-done').hidden = true;
    const contactGrant = verifier.grant();
    if (!contactGrant) return showFieldError(contactForm, 'phone', '새 번호의 모의 확인을 먼저 완료해 주세요.');
    const currentPassword = contactForm.currentPassword.value;
    if (!currentPassword) return showFieldError(contactForm, 'currentPassword', '현재 비밀번호를 입력해 주세요.');

    const button = contactForm.querySelector('button[type="submit"]');
    setBusy(button, true, '변경 중…');
    try {
      await api.applyContact(currentPassword, contactGrant); // 204
      contactForm.reset();
      verifier.reset();
      await load();
      document.getElementById('contact-done').hidden = false;
    } catch (err) {
      contactForm.currentPassword.value = '';
      if (err.code === 'CONTACT_GRANT_INVALID') {
        verifier.reset();
        return showFieldError(contactForm, 'phone', '휴대폰 확인이 만료되었거나 유효하지 않습니다. 인증번호를 다시 요청해 주세요.');
      }
      showApiError(contactForm, err, {
        REAUTHENTICATION_FAILED: { field: 'currentPassword', message: '현재 비밀번호가 올바르지 않습니다.' },
        RATE_LIMITED: { message: '비밀번호 확인 요청이 너무 많습니다. 5분 뒤 다시 시도해 주세요.' },
      });
    } finally {
      setBusy(button, false);
    }
  });

  load();
}
