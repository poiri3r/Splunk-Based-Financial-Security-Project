// 거래내역조회 (작업 요청서 A4·R8). ?account=<계좌 UUID>&from=&to=&type= 로 조건을 받는다.
// 조회 폼은 GET으로 제출되어 같은 페이지를 조건과 함께 다시 연다(조회 조건이 접근 로그에 남는다).
// - 다음 페이지는 서버가 돌려준 from/to와 같은 필터 + nextCursor로 요청한다. 커서는 해석·수정하지 않는다.
// - 조건이 바뀌면 페이지가 새로 열리므로 이전 커서는 자연히 버려진다.
// - 입출금 표시는 금액 부호가 아니라 direction으로, 잔액은 서버의 balanceAfter로 보여 준다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import {
  formatAmount, formatSignedAmount, formatDateTime, formatCounterparty, directionLabel,
} from '../format.js';
import { clearErrors, showFieldError, showFormError, showApiError, el, transferLink, isDebitCandidate, setAccountTitle, isOpenAccount } from '../ui.js';

const PAGE_SIZE = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['ALL', 'DEPOSIT', 'WITHDRAWAL'];

if (requireAuth()) init();

function init() {
  const filter = document.getElementById('tx-filter');
  const section = document.getElementById('tx-section');
  const select = document.getElementById('tx-select');
  const table = document.getElementById('tx-table');
  const tbody = document.getElementById('tx-body');
  const empty = document.getElementById('tx-empty');
  const loading = document.getElementById('tx-loading');
  const moreBox = document.getElementById('tx-more-box');
  const moreButton = document.getElementById('tx-more');

  const params = new URLSearchParams(location.search);
  const query = {
    from: DATE_RE.test(params.get('from') ?? '') ? params.get('from') : undefined,
    to: DATE_RE.test(params.get('to') ?? '') ? params.get('to') : undefined,
    type: TYPES.includes(params.get('type')) ? params.get('type') : 'ALL',
  };
  filter.from.value = query.from ?? '';
  filter.to.value = query.to ?? '';
  filter.type.value = query.type;

  let page = null; // 마지막 응답 { from, to, nextCursor, hasNext }

  filter.addEventListener('submit', (event) => {
    clearErrors(filter);
    if (filter.from.value && filter.to.value && filter.from.value > filter.to.value) {
      event.preventDefault();
      showFieldError(filter, 'from', '시작일이 종료일보다 늦습니다.');
    }
  });

  function rowOf(t) {
    const cls = t.direction === 'DEPOSIT' ? 'in' : 'out';
    return el('tr', {}, [
      el('td', { textContent: formatDateTime(t.createdAt) }),
      el('td', {}, [el('span', { className: `tag ${cls}`, textContent: directionLabel(t.direction) })]),
      el('td', { textContent: formatCounterparty(t.counterparty) }),
      el('td', { className: `num ${cls}`, textContent: formatSignedAmount(t.amount, t.direction) }),
      el('td', { className: 'num plain', textContent: formatAmount(t.balanceAfter) }),
    ]);
  }

  async function loadPage(accountId, cursor) {
    clearErrors(section);
    loading.hidden = false;
    moreButton.disabled = true;
    try {
      // 이어 보기는 첫 응답의 from/to를 그대로 쓴다(날짜를 비워 조회했어도 같은 범위로 이어진다).
      const res = await api.getTransactions(accountId, cursor
        ? { from: page.from, to: page.to, type: query.type, size: PAGE_SIZE, cursor }
        : { ...query, size: PAGE_SIZE });
      page = res;
      if (!cursor) tbody.replaceChildren();
      tbody.append(...res.items.map(rowOf)); // 응답은 이미 최신순이다
      const total = tbody.children.length;
      table.hidden = total === 0;
      empty.hidden = total !== 0;
      moreBox.hidden = !res.hasNext;
      document.getElementById('tx-range').textContent = `조회 기간 ${res.from} ~ ${res.to} (한국 날짜 기준)`;
      if (!cursor) {
        filter.from.value = res.from;
        filter.to.value = res.to;
      }
    } catch (err) {
      showApiError(section, err, {
        INVALID_INPUT: { message: '조회 기간은 최대 1년, 시작일은 종료일보다 빨라야 합니다.' },
      });
    } finally {
      loading.hidden = true;
      moreButton.disabled = false;
    }
  }

  async function start() {
    const requested = params.get('account');
    let accounts = [];
    let all = [];
    try {
      // 숨긴 계좌도 내역은 볼 수 있게 관리 목록을 쓴다. 해지 계좌는 빼고 해지계좌조회로 안내한다.
      all = (await api.listAccounts({ includeHidden: true })).items;
      accounts = all.filter(isOpenAccount);
    } catch (err) {
      showApiError(section, err);
      loading.hidden = true;
      return;
    }
    if (accounts.length === 0) {
      loading.hidden = true;
      document.getElementById('tx-no-accounts').hidden = false;
      return;
    }
    select.replaceChildren(...accounts.map((a) => el('option', {
      value: a.accountId,
      textContent: `${a.preferences?.alias || a.accountName} ${a.number}${a.preferences?.hidden ? ' (숨김)' : ''}`,
    })));

    if (requested && all.some((a) => a.accountId === requested && !isOpenAccount(a))) {
      loading.hidden = true;
      showFormError(section, '해지된 계좌입니다. 해지된 계좌의 내역은 조회 > 해지계좌조회에서 확인해 주세요.');
      return;
    }
    if (requested !== null && !UUID_RE.test(requested)) {
      loading.hidden = true;
      showFormError(section, '계좌 정보가 올바르지 않습니다. 계좌를 다시 선택해 주세요.');
      return;
    }
    const account = requested ? accounts.find((a) => a.accountId === requested) : accounts.find((a) => !a.preferences?.hidden) ?? accounts[0];
    // 내 목록에 없는 계좌도 서버에 그대로 묻는다(404 ACCOUNT_NOT_FOUND로 판단).
    const accountId = account?.accountId ?? requested;
    select.value = accountId;
    if (account) {
      setAccountTitle(document.getElementById('tx-account-name'), account);
      document.getElementById('tx-account').textContent = account.number;
      document.getElementById('tx-balance').textContent = `잔액 ${formatAmount(account.balance)}`;
      if (isDebitCandidate(account)) {
        const link = document.getElementById('tx-transfer');
        link.href = transferLink(accountId);
        link.hidden = false;
      }
    }
    moreButton.addEventListener('click', () => { if (page?.nextCursor) loadPage(accountId, page.nextCursor); });
    await loadPage(accountId, null);
  }

  start();
}
