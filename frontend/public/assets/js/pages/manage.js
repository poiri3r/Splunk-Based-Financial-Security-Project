// 계좌 관리 (작업 요청서 A5, 흐름도 F7). ?account=<계좌 UUID>
// - 별명·숨김·순서: PATCH preferences { version, ... } (일반 설정, 승인 불필요)
// - 출금 등록·계좌 비밀번호 변경: step-up(로그인 비밀번호, changes) → actionToken → PUT. 승인은 그 changes에만 유효하다.
// - 모든 변경은 최신 version으로 보낸다. 충돌하면 다시 읽고 사용자에게 다시 확인받는다.
// - 잠긴 계좌 비밀번호는 일반 변경 대신 재설정 절차(/mypage/pin-reset)로 보낸다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { validatePin, validatePinFormat } from '../validate.js';
import { formatAmount, ACCOUNT_TYPE_LABELS } from '../format.js';
import {
  clearErrors, showFieldError, showFormError, showApiError, setBusy, el, pinResetLink, isDebitCandidate,
} from '../ui.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (requireAuth()) init();

function init() {
  const listSection = document.getElementById('list-section');
  const list = document.getElementById('m-list');
  const prefForm = document.getElementById('pref-form');
  const debitForm = document.getElementById('debit-form');
  const pinForm = document.getElementById('pin-form');

  let accounts = [];
  let selected = null; // 계좌 상세 (preferences 포함)
  let myPhone = null; // 새 PIN에 휴대폰 번호 숫자가 들어가는지 미리 확인하는 데만 쓴다

  const hideDone = () => ['pref-done', 'pin-done'].forEach((idName) => { document.getElementById(idName).hidden = true; });

  function renderList() {
    list.replaceChildren(...accounts.map((a) => {
      const p = a.preferences;
      const choose = el('button', { type: 'button', className: 'button small', textContent: a.accountId === selected?.accountId ? '선택됨' : '선택' });
      choose.disabled = a.accountId === selected?.accountId;
      choose.addEventListener('click', () => select(a.accountId));
      const actions = [choose];
      if (p.hidden) {
        const unhide = el('button', { type: 'button', className: 'button small primary', textContent: '숨김 해제' });
        unhide.addEventListener('click', () => savePreferences(a, { hidden: false }, listSection, unhide));
        actions.push(unhide);
      }
      return el('li', { className: 'account' }, [
        el('div', { className: 'account-info' }, [
          el('span', { className: 'account-type', textContent: `${ACCOUNT_TYPE_LABELS[a.accountType] ?? a.accountType} · ${a.accountName}${a.status === 'CLOSED' ? ' (해지)' : ''}` }),
          p.alias ? el('strong', { className: 'account-alias', textContent: p.alias }) : '',
          el('span', { className: 'account-number', textContent: `${a.number} · 순서 ${p.order}` }),
          el('span', { className: 'tags' }, p.hidden ? [el('span', { className: 'tag out', textContent: '숨김' })] : []),
        ]),
        el('div', { className: 'actions' }, actions),
      ]);
    }));
  }

  function renderDetail() {
    const a = selected;
    const p = a.preferences;
    document.getElementById('m-name').textContent = `${ACCOUNT_TYPE_LABELS[a.accountType] ?? ''} ${p.alias || a.accountName}`;
    document.getElementById('m-number').textContent = `${a.number} · 잔액 ${formatAmount(a.balance)}`;
    prefForm.alias.value = p.alias ?? '';
    prefForm.order.value = String(p.order);
    prefForm.elements.namedItem('hideAccount').checked = p.hidden;

    // 출금 등록·계좌 비밀번호는 정상 입출금 계좌에만 있다.
    const checking = isDebitCandidate(a);
    document.getElementById('debit-section').hidden = !checking;
    document.getElementById('pin-section').hidden = !checking;
    if (checking) {
      document.getElementById('m-debit').textContent = p.debitEnabled ? '출금 가능' : '출금 해제됨';
      document.getElementById('debit-submit').textContent = p.debitEnabled ? '출금 해제' : '출금 등록';
      const resetHref = pinResetLink(a.accountId);
      document.getElementById('pin-reset-link').href = resetHref;
      document.getElementById('pin-reset-link2').href = resetHref;
      document.getElementById('pin-locked').hidden = !p.pinLocked;
      pinForm.hidden = p.pinLocked;
      document.getElementById('pin-first').hidden = p.pinConfigured;
      document.getElementById('current-pin-field').hidden = !p.pinConfigured;
    }
    document.getElementById('m-detail').hidden = false;
  }

  async function loadAccounts() {
    accounts = (await api.listAccounts({ includeHidden: true })).items;
  }

  async function select(accountId) {
    hideDone();
    [prefForm, debitForm, pinForm].forEach((f) => { clearErrors(f); f.reset(); });
    selected = accounts.find((a) => a.accountId === accountId) ?? null;
    if (!selected) return;
    history.replaceState(null, '', `?account=${encodeURIComponent(accountId)}`);
    renderList();
    renderDetail();
  }

  // 변경 후에는 서버 값으로 목록·상세를 다시 그린다.
  async function reload() {
    await loadAccounts();
    if (selected) selected = accounts.find((a) => a.accountId === selected.accountId) ?? null;
    renderList();
    if (selected) renderDetail();
  }

  async function savePreferences(account, changes, scope, button) {
    clearErrors(scope);
    setBusy(button, true, '저장 중…');
    try {
      await api.updatePreferences(account.accountId, { version: account.preferences.version, ...changes });
      await reload();
      return true;
    } catch (err) {
      if (err.code === 'VERSION_CONFLICT') await reload();
      showApiError(scope, err, { INVALID_INPUT: { message: '별명은 50자 이내, 순서는 0~9999의 정수로 입력해 주세요.' } });
      return false;
    } finally {
      setBusy(button, false);
    }
  }

  prefForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideDone();
    clearErrors(prefForm);
    const alias = prefForm.alias.value.trim();
    if (alias.length > 50) return showFieldError(prefForm, 'alias', '별명은 50자 이내로 입력해 주세요.');
    const order = Number(prefForm.order.value);
    if (!Number.isInteger(order) || order < 0 || order > 9999) return showFieldError(prefForm, 'order', '0~9999의 정수로 입력해 주세요.');
    const ok = await savePreferences(selected, { alias: alias || null, hidden: prefForm.elements.namedItem('hideAccount').checked, order },
      prefForm, prefForm.querySelector('button[type="submit"]'));
    if (ok) document.getElementById('pref-done').hidden = false;
  });

  debitForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(debitForm);
    const password = debitForm.password.value;
    if (!password) return showFieldError(debitForm, 'password', '로그인 비밀번호를 입력해 주세요.');
    const changes = { version: selected.preferences.version, enabled: !selected.preferences.debitEnabled };
    const button = document.getElementById('debit-submit');
    setBusy(button, true, '처리 중…');
    try {
      const { actionToken } = await api.stepUp({ purpose: 'DEBIT_SETTING', targetId: selected.accountId, password, changes });
      await api.setDebit(selected.accountId, changes, actionToken);
      debitForm.reset();
      await reload();
    } catch (err) {
      debitForm.password.value = '';
      if (err.code === 'VERSION_CONFLICT') await reload();
      showApiError(debitForm, err, {
        REAUTHENTICATION_FAILED: { field: 'password', message: '로그인 비밀번호가 올바르지 않습니다.' },
        ACTION_TOKEN_INVALID: { message: '승인이 만료되었습니다. 다시 시도해 주세요.' },
      });
    } finally {
      setBusy(button, false);
    }
  });

  pinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideDone();
    clearErrors(pinForm);
    const p = selected.preferences;
    const password = pinForm.password.value;
    const currentPin = pinForm.currentPin.value;
    const newPin = pinForm.newPin.value;
    if (!password) return showFieldError(pinForm, 'password', '로그인 비밀번호를 입력해 주세요.');
    if (p.pinConfigured) {
      const currentError = validatePinFormat(currentPin);
      if (currentError) return showFieldError(pinForm, 'currentPin', currentError);
    }
    const pinError = validatePin(newPin, { phone: myPhone });
    if (pinError) return showFieldError(pinForm, 'newPin', pinError);
    if (newPin !== pinForm.newPinConfirm.value) return showFieldError(pinForm, 'newPinConfirm', '새 계좌 비밀번호가 일치하지 않습니다.');

    const changes = { version: p.version, newPin };
    const button = pinForm.querySelector('button[type="submit"]');
    setBusy(button, true, '변경 중…');
    try {
      const { actionToken } = await api.stepUp({ purpose: 'ACCOUNT_PIN', targetId: selected.accountId, password, changes });
      await api.changePin(selected.accountId, changes, actionToken, p.pinConfigured ? currentPin : undefined);
      pinForm.reset();
      await reload();
      document.getElementById('pin-done').hidden = false;
    } catch (err) {
      pinForm.password.value = '';
      pinForm.currentPin.value = '';
      if (err.code === 'VERSION_CONFLICT' || err.code === 'PIN_LOCKED') await reload();
      showApiError(pinForm, err, {
        REAUTHENTICATION_FAILED: { field: 'password', message: '로그인 비밀번호가 올바르지 않습니다.' },
        PIN_INVALID: { field: 'currentPin', message: '현재 계좌 비밀번호가 올바르지 않습니다. 4번 틀리면 잠깁니다.' },
        WEAK_CREDENTIAL: { field: 'newPin', message: '반복·연속 숫자나 휴대폰 번호에 든 숫자는 쓸 수 없습니다.' },
        ACTION_TOKEN_INVALID: { message: '승인이 만료되었습니다. 다시 시도해 주세요.' },
      });
    } finally {
      setBusy(button, false);
    }
  });

  async function start() {
    try {
      await loadAccounts();
    } catch (err) {
      showApiError(listSection, err);
      return;
    } finally {
      document.getElementById('m-loading').hidden = true;
    }
    if (accounts.length === 0) {
      showFormError(listSection, '계좌가 없습니다. 먼저 계좌를 개설해 주세요.');
      return;
    }
    const requested = new URLSearchParams(location.search).get('account');
    const initial = requested && UUID_RE.test(requested) && accounts.some((a) => a.accountId === requested)
      ? requested : accounts[0].accountId;
    select(initial);
    try { myPhone = (await api.getMe()).phone; } catch (err) { if (!err.handled) myPhone = null; }
  }

  start();
}
