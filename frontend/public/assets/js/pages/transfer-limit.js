// 이체한도 조회·감액 (작업 요청서 A5, 흐름도 F7).
// 변경은 2단계다: step-up(purpose=TRANSFER_LIMITS, targetId=customerId, changes) → PUT { changes, actionToken }.
// 승인 권한은 승인받은 changes 그대로만 쓸 수 있다. 버전 충돌이나 값 수정 뒤에는 재조회·재승인한다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { parseMoneyInput, compareMoney } from '../money.js';
import { formatAmount, formatDate } from '../format.js';
import { clearErrors, showFieldError, showApiError, setBusy } from '../ui.js';
import { bindStepUpWait, noteStepUpLimit } from '../step-up-wait.js';

if (requireAuth()) init();

function init() {
  const section = document.getElementById('limit-section');
  const form = document.getElementById('limit-form');
  const submit = form.querySelector('button[type="submit"]');
  const done = document.getElementById('limit-done');
  let limits = null; // { customerId, perTransfer, daily, usedToday, remainingDaily, date, version }

  function render() {
    document.getElementById('l-per').textContent = formatAmount(limits.perTransfer);
    document.getElementById('l-daily').textContent = formatAmount(limits.daily);
    document.getElementById('l-used').textContent = formatAmount(limits.usedToday);
    document.getElementById('l-remaining').textContent = formatAmount(limits.remainingDaily);
    document.getElementById('l-date').textContent = formatDate(limits.date);
    document.getElementById('limit-view').hidden = false;
    document.getElementById('change-section').hidden = false;
  }

  async function load() {
    clearErrors(section);
    document.getElementById('limit-loading').hidden = false;
    try {
      limits = await api.getLimits();
      render();
    } catch (err) {
      showApiError(section, err);
    } finally {
      document.getElementById('limit-loading').hidden = true;
    }
  }

  function readAmount(name) {
    const { value, error } = parseMoneyInput(form[name].value);
    if (error) { showFieldError(form, name, error); return null; }
    return value;
  }

  // 한도 변경 승인도 이체·계좌 설정과 같은 step-up 제한을 쓴다.
  const stepUpWait = bindStepUpWait(form, [submit]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (stepUpWait.isWaiting()) return;
    clearErrors(form);
    done.hidden = true;
    if (!limits) return;
    const perTransfer = readAmount('perTransfer');
    if (!perTransfer) return;
    const daily = readAmount('daily');
    if (!daily) return;
    if (compareMoney(perTransfer, daily) > 0) return showFieldError(form, 'perTransfer', '1회 한도는 1일 한도보다 클 수 없습니다.');
    if (compareMoney(perTransfer, limits.perTransfer) > 0) return showFieldError(form, 'perTransfer', '현재 1회 한도보다 크게 바꿀 수 없습니다.');
    if (compareMoney(daily, limits.daily) > 0) return showFieldError(form, 'daily', '현재 1일 한도보다 크게 바꿀 수 없습니다.');
    const password = form.password.value;
    if (!password) return showFieldError(form, 'password', '로그인 비밀번호를 입력해 주세요.');

    const changes = { version: limits.version, perTransfer, daily };
    setBusy(submit, true, '변경 중…');
    try {
      const { actionToken } = await api.stepUp({ purpose: 'TRANSFER_LIMITS', targetId: limits.customerId, password, changes });
      limits = await api.updateLimits(changes, actionToken);
      form.reset();
      render();
      done.hidden = false;
    } catch (err) {
      form.password.value = '';
      if (err.code === 'VERSION_CONFLICT') await load();
      if (noteStepUpLimit(err)) return;
      showApiError(form, err, {
        REAUTHENTICATION_FAILED: { field: 'password', message: '로그인 비밀번호가 올바르지 않습니다.' },
        LIMIT_INCREASE_NOT_ALLOWED: { message: '이 화면에서는 한도를 줄이기만 할 수 있습니다.' },
        ACTION_TOKEN_INVALID: { message: '승인이 만료되었거나 변경 내용이 달라졌습니다. 다시 시도해 주세요.' },
        INVALID_INPUT: { message: '한도 값을 확인해 주세요. 1회 한도는 1일 한도 이하여야 합니다.' },
      });
    } finally {
      setBusy(submit, false);
      stepUpWait.sync();
    }
  });

  document.getElementById('limit-refresh').addEventListener('click', load);
  load();
}
