// 자주 쓰는 계좌 (작업 요청서 A5): 목록·등록·별명 수정·삭제.
// 수정·삭제는 최신 version을 함께 보낸다. 충돌(VERSION_CONFLICT)이면 목록을 다시 읽는다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { validateAccountNumber } from '../validate.js';
import { formatDateTime } from '../format.js';
import { clearErrors, showFieldError, showApiError, setBusy, el } from '../ui.js';

if (requireAuth()) init();

function init() {
  const addForm = document.getElementById('add-form');
  const section = document.getElementById('list-section');
  const list = document.getElementById('b-list');

  const normalizeAlias = (text) => text.trim() || null; // 빈 별명은 null로 지운다

  function itemOf(b) {
    const aliasInput = el('input', { type: 'text', value: b.alias ?? '', maxLength: 50, ariaLabel: '별명' });
    const save = el('button', { type: 'button', className: 'button small', textContent: '별명 저장' });
    const remove = el('button', { type: 'button', className: 'button small danger', textContent: '삭제' });
    save.addEventListener('click', async () => {
      clearErrors(section);
      setBusy(save, true, '저장 중…');
      try {
        await api.updateBeneficiary(b.id, b.version, normalizeAlias(aliasInput.value));
        await load();
      } catch (err) {
        if (err.code === 'VERSION_CONFLICT' || err.code === 'BENEFICIARY_NOT_FOUND') await load();
        showApiError(section, err, {
          BENEFICIARY_NOT_FOUND: { message: '이미 삭제된 계좌입니다. 목록을 새로 불러왔습니다.' },
          INVALID_INPUT: { message: '별명은 50자 이내로 입력해 주세요.' },
        });
        setBusy(save, false);
      }
    });
    remove.addEventListener('click', async () => {
      if (!window.confirm(`${b.accountNumber} 계좌를 자주 쓰는 계좌에서 삭제할까요?`)) return;
      clearErrors(section);
      setBusy(remove, true, '삭제 중…');
      try {
        await api.deleteBeneficiary(b.id, b.version); // 204
        await load();
      } catch (err) {
        if (err.code === 'VERSION_CONFLICT' || err.code === 'BENEFICIARY_NOT_FOUND') await load();
        showApiError(section, err, { BENEFICIARY_NOT_FOUND: { message: '이미 삭제된 계좌입니다. 목록을 새로 불러왔습니다.' } });
        setBusy(remove, false);
      }
    });
    return el('li', { className: 'account' }, [
      el('div', { className: 'account-info' }, [
        el('span', { className: 'account-number', textContent: b.accountNumber }),
        el('span', { className: 'muted small', textContent: `등록 ${formatDateTime(b.createdAt)}` }),
      ]),
      el('div', { className: 'actions' }, [aliasInput, save, remove]),
    ]);
  }

  async function load() {
    document.getElementById('b-loading').hidden = false;
    try {
      const { items } = await api.listBeneficiaries();
      list.replaceChildren(...items.map(itemOf));
      document.getElementById('b-count').textContent = `${items.length} / 100`;
      document.getElementById('b-empty').hidden = items.length !== 0;
    } catch (err) {
      showApiError(section, err);
    } finally {
      document.getElementById('b-loading').hidden = true;
    }
  }

  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(addForm);
    const accountNumber = addForm.accountNumber.value.trim().replace(/-/g, '');
    const numberError = validateAccountNumber(accountNumber);
    if (numberError) return showFieldError(addForm, 'accountNumber', numberError);
    const alias = normalizeAlias(addForm.alias.value);
    if (alias && alias.length > 50) return showFieldError(addForm, 'alias', '별명은 50자 이내로 입력해 주세요.');

    const button = addForm.querySelector('button[type="submit"]');
    setBusy(button, true, '등록 중…');
    try {
      await api.addBeneficiary(accountNumber, alias); // 201
      addForm.reset();
      await load();
    } catch (err) {
      showApiError(addForm, err, {
        ACCOUNT_NOT_FOUND: { field: 'accountNumber', message: '계좌를 찾을 수 없습니다. 계좌번호를 확인해 주세요.' },
        ACCOUNT_UNAVAILABLE: { field: 'accountNumber', message: '받을 수 없는 계좌입니다(해지 등).' },
        BENEFICIARY_EXISTS: { field: 'accountNumber', message: '이미 등록한 계좌입니다.' },
        BENEFICIARY_LIMIT: { message: '최대 100개까지 등록할 수 있습니다.' },
      });
    } finally {
      setBusy(button, false);
    }
  });

  load();
}
