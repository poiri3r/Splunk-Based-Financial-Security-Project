// 회원가입 (작업 요청서 R1, 추가 협의 C1·C2).
// 1) 약관은 GET /api/v2/terms에서 읽는다(버전을 화면에 고정하지 않는다).
// 2) 휴대폰은 가입 본문에 넣지 않는다. REGISTER/SMS 모의 확인으로 받은 contactGrant를 넣는다.
// 3) 가입은 멱등키를 쓴다. 결과가 불확실하면 같은 키·같은 본문으로 다시 보내 회원이 한 번만 생기게 한다.
import { api } from '../api.js';
import { getToken } from '../session.js';
import { validateUsername, validatePassword, validateName, normalizePhone } from '../validate.js';
import {
  clearErrors, showFieldError, showFormError, showApiError, setBusy, el, guardUnload, setDisabled,
} from '../ui.js';
import { setupContactVerify } from '../contact-verify.js';
import { ROUTES } from '../routes.js';

if (getToken()) location.replace(ROUTES.home);

const form = document.getElementById('register-form');
const submit = form.querySelector('button[type="submit"]');
const uncertainBox = document.getElementById('register-uncertain');
const termsList = document.getElementById('terms-list');
const agreeAll = document.getElementById('agree-all');

let signupTerms = []; // [{ id, version, text }] 가입 때 동의할 필수 약관
let pendingTx = null; // 결과 불명인 가입. 같은 키로만 다시 보낸다.

const verifier = setupContactVerify(form, { purpose: 'REGISTER' });

// ---- 약관 ----------------------------------------------------------------

const TERM_TITLES = { SERVICE: '서비스 이용약관', PRIVACY: '개인정보 수집·이용 동의' };
const termBoxes = () => [...termsList.querySelectorAll('input[type="checkbox"]')];

async function loadTerms() {
  const loading = document.getElementById('terms-loading');
  loading.hidden = false;
  try {
    const { items } = await api.terms();
    // 가입 약관은 required=true인 항목이다. CHECKING(scope=ACCOUNT_OPEN)은 계좌개설 때 동의한다.
    signupTerms = items.filter((t) => t.required && t.scope !== 'ACCOUNT_OPEN');
    termsList.replaceChildren(...signupTerms.map((t) => el('li', {}, [
      el('label', { className: 'check' }, [
        el('input', { type: 'checkbox', value: t.id }),
        el('span', { textContent: `[필수] ${TERM_TITLES[t.id] ?? t.id} (${t.version})` }),
      ]),
      el('details', {}, [el('summary', { textContent: '보기' }), el('p', { className: 'muted', textContent: t.text })]),
    ])));
    termBoxes().forEach((box) => box.addEventListener('change', () => {
      agreeAll.checked = termBoxes().every((b) => b.checked);
    }));
    agreeAll.checked = false;
    document.getElementById('terms-box').hidden = false;
  } catch (err) {
    showApiError(form, err);
  } finally {
    loading.hidden = true;
  }
}
agreeAll.addEventListener('change', () => termBoxes().forEach((box) => { box.checked = agreeAll.checked; }));

// ---- 제출 ----------------------------------------------------------------

function lock(locked) {
  setDisabled([...form.querySelectorAll('input:not([name="code"])'), agreeAll], locked);
  verifier.lock(locked);
  guardUnload(locked);
  uncertainBox.hidden = !locked;
  submit.textContent = locked ? '같은 내용으로 다시 시도' : '가입하기';
}

function buildTx() {
  const username = form.username.value.trim();
  const password = form.password.value;
  const usernameError = validateUsername(username);
  if (usernameError) return showFieldError(form, 'username', usernameError);
  const passwordError = validatePassword(password, { username, phone: normalizePhone(form.phone.value) });
  if (passwordError) return showFieldError(form, 'password', passwordError);
  if (password !== form.passwordConfirm.value) return showFieldError(form, 'passwordConfirm', '비밀번호가 일치하지 않습니다.');
  // form.name은 폼 자신의 name 속성이라 입력칸은 elements로 꺼낸다.
  const name = form.elements.namedItem('name').value.trim();
  const nameError = validateName(name);
  if (nameError) return showFieldError(form, 'name', nameError);
  if (signupTerms.length === 0) return showFormError(form, '약관을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
  if (termBoxes().some((box) => !box.checked)) return showFieldError(form, 'terms', '필수 약관에 모두 동의해 주세요.');
  const contactGrant = verifier.grant();
  if (!contactGrant) return showFieldError(form, 'phone', '휴대폰 모의 확인을 먼저 완료해 주세요.');

  const termsVersions = Object.fromEntries(signupTerms.map((t) => [t.id, t.version]));
  return api.newRegistration({ username, password, name, termsVersions, contactGrant });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(form);
  const tx = pendingTx || buildTx();
  if (!tx) return;

  setBusy(submit, true, '가입 중…');
  try {
    await tx.submit(); // 201 { customerId }
    pendingTx = null;
    guardUnload(false);
    location.replace(`${ROUTES.login}?registered=1`);
    return;
  } catch (err) {
    setBusy(submit, false);
    if (err.uncertain) {
      pendingTx = tx;
      lock(true);
      return;
    }
    pendingTx = null;
    lock(false);
    switch (err.code) {
      case 'TERMS_VERSION_REQUIRED':
        showFormError(form, '약관이 바뀌었습니다. 다시 불러온 약관을 확인하고 동의해 주세요.');
        loadTerms();
        return;
      case 'CONTACT_GRANT_INVALID':
      case 'PHONE_CONFIRMATION_REQUIRED':
        verifier.reset();
        showFieldError(form, 'phone', '휴대폰 확인이 만료되었거나 유효하지 않습니다. 인증번호를 다시 요청해 주세요.');
        return;
      default:
        showApiError(form, err, {
          DUPLICATE_USERNAME: { field: 'username', message: '이미 사용 중인 아이디입니다.' },
          WEAK_CREDENTIAL: { field: 'password', message: '반복·연속 문자나 아이디·휴대폰 번호가 들어간 비밀번호는 쓸 수 없습니다.' },
          RATE_LIMITED: { message: '가입 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
        });
    }
  }
});

loadTerms();
