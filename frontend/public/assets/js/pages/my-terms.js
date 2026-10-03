// 약관 동의 내역 (작업 요청서 A7 보완). GET /api/v2/me/terms → { items: [{ id, version, acceptedAt }] }
// 가입 때 기록된 항목만 온다. 상품·계좌개설 약관까지 같은 API로 온다고 가정하지 않는다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { formatDateTime } from '../format.js';
import { showApiError, el } from '../ui.js';

const TERM_TITLES = { SERVICE: '서비스 이용약관', PRIVACY: '개인정보 수집·이용 동의', CHECKING: '입출금통장 약관' };

if (requireAuth()) init();

async function init() {
  const section = document.getElementById('terms-section');
  try {
    const { items } = await api.myTerms();
    document.getElementById('t-body').replaceChildren(...items.map((t) => el('tr', {}, [
      el('td', { textContent: TERM_TITLES[t.id] ?? t.id }),
      el('td', { className: 'mono', textContent: t.version }),
      el('td', { textContent: formatDateTime(t.acceptedAt) }),
    ])));
    document.getElementById('t-table').hidden = items.length === 0;
    document.getElementById('t-empty').hidden = items.length !== 0;
  } catch (err) {
    showApiError(section, err);
  } finally {
    document.getElementById('t-loading').hidden = true;
  }
}
