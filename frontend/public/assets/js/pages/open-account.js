// 계좌개설 (임시). 단계형 화면(약관 → 상품 선택 → 옵션 → 확인)은 옵션 항목이 정해진 뒤 만든다.
// 지금은 백엔드 계약대로 본문 없는 POST /api/accounts 한 번이다.
import { api, isUncertain } from '../api.js';
import { requireAuth } from '../session.js';
import { formatAmount } from '../format.js';
import { clearErrors, showFormError, showApiError, setBusy, transactionsLink, depositLink } from '../ui.js';
import { ROUTES } from '../routes.js';

if (requireAuth()) init();

function init() {
  const section = document.getElementById('open-section');
  const agree = document.getElementById('open-agree');
  const button = document.getElementById('open-account');
  const result = document.getElementById('open-result');

  agree.addEventListener('change', () => { button.disabled = !agree.checked; });

  // 계좌 개설은 멱등하지 않으므로 자동 재시도하지 않는다.
  button.addEventListener('click', async () => {
    clearErrors(section);
    setBusy(button, true, '개설 중…');
    let res;
    try {
      res = await api.openAccount(); // 201 { number, balance }
    } catch (err) {
      if (isUncertain(err)) {
        showFormError(section, '계좌 개설 결과를 확인하지 못했습니다. 전체계좌조회에서 개설 여부를 확인한 뒤 다시 시도해 주세요.');
      } else {
        showApiError(section, err);
      }
      setBusy(button, false);
      return;
    }
    section.hidden = true;
    if (res && typeof res.number === 'string') {
      document.getElementById('result-number').textContent = res.number;
      document.getElementById('result-balance').textContent = formatAmount(res.balance);
      document.getElementById('result-history').href = transactionsLink(res.number);
      document.getElementById('result-deposit').href = depositLink(res.number);
    } else {
      // 계약상 번호가 와야 한다. 없으면 목록에서 확인하도록 안내한다.
      console.error('[open-account] 계좌 개설 응답 형식이 계약과 다릅니다.', res);
      document.getElementById('result-summary').hidden = true;
      document.getElementById('result-history').href = ROUTES.accounts;
    }
    result.hidden = false;
  });
}
