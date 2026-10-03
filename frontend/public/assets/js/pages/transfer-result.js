// 이체결과조회 (작업 요청서 A3). 목록 GET /api/v2/transfers, 상세 GET /api/v2/transfers/{transferId}.
// 상세는 이 화면 목록이나 이체 완료 화면이 준 이체 ID로만 연다.
// 거래내역의 transferId에는 가상 입금·예적금 원장의 ID도 섞여 있으므로 그 값을 여기로 보내지 않는다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { formatAmount, formatDateTime } from '../format.js';
import { clearErrors, showFieldError, showApiError, el, transferResultLink } from '../ui.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 20;

if (requireAuth()) init();

function init() {
  const params = new URLSearchParams(location.search);
  const filter = document.getElementById('result-filter');
  const listSection = document.getElementById('list-section');
  const tbody = document.getElementById('r-body');
  const moreBox = document.getElementById('r-more-box');
  const moreButton = document.getElementById('r-more');
  const query = {
    from: DATE_RE.test(params.get('from') ?? '') ? params.get('from') : undefined,
    to: DATE_RE.test(params.get('to') ?? '') ? params.get('to') : undefined,
  };
  let page = null;

  filter.addEventListener('submit', (event) => {
    clearErrors(filter);
    if (filter.from.value && filter.to.value && filter.from.value > filter.to.value) {
      event.preventDefault();
      showFieldError(filter, 'from', '시작일이 종료일보다 늦습니다.');
    }
  });

  async function loadDetail(transferId) {
    const section = document.getElementById('detail-section');
    section.hidden = false;
    try {
      const r = await api.getTransfer(transferId);
      document.getElementById('d-id').textContent = r.transferId;
      document.getElementById('d-status').textContent = r.status === 'completed' ? '완료' : r.status;
      document.getElementById('d-time').textContent = formatDateTime(r.createdAt);
      document.getElementById('d-from').textContent = r.details.fromAccountNumber;
      document.getElementById('d-to').textContent = r.details.toAccountNumber;
      document.getElementById('d-name').textContent = r.details.receiverName;
      document.getElementById('d-amount').textContent = formatAmount(r.amount);
      document.getElementById('d-fee').textContent = formatAmount(r.fee);
      document.getElementById('d-balance').textContent = formatAmount(r.balanceAfter);
      document.getElementById('d-memo').textContent = r.details.memo || '없음';
      document.getElementById('detail').hidden = false;
    } catch (err) {
      showApiError(section, err, {
        TRANSFER_NOT_FOUND: { message: '이체 정보가 없거나 접근할 수 없습니다.' },
      });
    }
  }

  async function loadPage(cursor) {
    clearErrors(listSection);
    document.getElementById('r-loading').hidden = false;
    moreButton.disabled = true;
    try {
      const res = await api.listTransfers(cursor
        ? { from: page.from, to: page.to, size: PAGE_SIZE, cursor }
        : { ...query, size: PAGE_SIZE });
      page = res;
      if (!cursor) tbody.replaceChildren();
      tbody.append(...res.items.map((r) => el('tr', {}, [
        el('td', { textContent: formatDateTime(r.createdAt) }),
        el('td', { className: 'mono', textContent: r.details.toAccountNumber }),
        el('td', { textContent: r.details.receiverName }),
        el('td', { className: 'num out', textContent: formatAmount(r.amount) }),
        el('td', { className: 'num plain', textContent: formatAmount(r.balanceAfter) }),
        el('td', {}, [el('a', { href: transferResultLink(r.transferId), textContent: '보기' })]),
      ])));
      const total = tbody.children.length;
      document.getElementById('r-table').hidden = total === 0;
      document.getElementById('r-empty').hidden = total !== 0;
      document.getElementById('r-range').textContent = `${res.from} ~ ${res.to}`;
      moreBox.hidden = !res.hasNext;
      if (!cursor) {
        filter.from.value = res.from;
        filter.to.value = res.to;
      }
    } catch (err) {
      showApiError(listSection, err, { INVALID_INPUT: { message: '조회 기간은 최대 1년, 시작일은 종료일보다 빨라야 합니다.' } });
    } finally {
      document.getElementById('r-loading').hidden = true;
      moreButton.disabled = false;
    }
  }

  moreButton.addEventListener('click', () => { if (page?.nextCursor) loadPage(page.nextCursor); });
  const id = params.get('id');
  if (id && UUID_RE.test(id)) loadDetail(id);
  loadPage(null);
}
