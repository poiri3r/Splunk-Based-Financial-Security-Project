// 해지계좌조회. 해지(CLOSED)된 계좌는 이 화면에서만 보여 준다(다른 조회 화면은 isOpenAccount로 거른다).
// - 목록: GET /api/v2/accounts?includeHidden=true 중 status=CLOSED. 지금 해지되는 계좌는 예금·적금 계좌뿐이다
//   (입출금 계좌 해지 API는 백엔드에 없다). 해지일은 예적금 가입 정보(closedOn)에서 가져온다.
// - 내역: GET /api/v2/accounts/{id}/transactions. 서버의 조회 기간은 최대 1년이므로
//   해지일(없으면 오늘)부터 거슬러 1년, 개설일보다 앞으로는 가지 않게 잡는다. 다음 페이지는 서버가 준 from/to + nextCursor.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import {
  formatAmount, formatSignedAmount, formatDateTime, formatDate, formatCounterparty, directionLabel, ACCOUNT_TYPE_LABELS,
} from '../format.js';
import { clearErrors, showApiError, el, setAccountTitle, savingsDetailLink } from '../ui.js';
import { kstToday } from '../savings.js';

const PAGE_SIZE = 20;
const kstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

// to에서 1년 전(서버 허용 최대 범위). 개설일보다 이르면 개설일.
function rangeOf(account, closedOn) {
  const to = closedOn && closedOn < kstToday() ? closedOn : kstToday();
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  const yearAgo = d.toISOString().slice(0, 10);
  const opened = kstDate.format(new Date(account.openedAt));
  return { from: opened > yearAgo ? opened : yearAgo, to };
}

if (requireAuth()) init();

function init() {
  const listSection = document.getElementById('closed-section');
  const txSection = document.getElementById('closed-tx');
  const tbody = document.getElementById('ctx-body');
  const moreBox = document.getElementById('ctx-more-box');
  const moreButton = document.getElementById('ctx-more');
  let current = null; // { accountId, from, to, nextCursor }

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

  async function loadHistory(cursor) {
    clearErrors(txSection);
    const loading = document.getElementById('ctx-loading');
    loading.hidden = false;
    moreButton.disabled = true;
    try {
      const res = await api.getTransactions(current.accountId, { from: current.from, to: current.to, type: 'ALL', size: PAGE_SIZE, cursor });
      current.from = res.from;
      current.to = res.to;
      current.nextCursor = res.nextCursor;
      if (!cursor) tbody.replaceChildren();
      tbody.append(...res.items.map(rowOf));
      const total = tbody.children.length;
      document.getElementById('ctx-table').hidden = total === 0;
      document.getElementById('ctx-empty').hidden = total !== 0;
      moreBox.hidden = !res.hasNext;
      document.getElementById('ctx-range').textContent = `조회 기간 ${res.from} ~ ${res.to} (한국 날짜 기준, 최대 1년)`;
    } catch (err) {
      showApiError(txSection, err);
    } finally {
      loading.hidden = true;
      moreButton.disabled = false;
    }
  }

  function showHistory(account, closedOn) {
    setAccountTitle(document.getElementById('ctx-name'), account);
    document.getElementById('ctx-number').textContent = account.number;
    current = { accountId: account.accountId, ...rangeOf(account, closedOn), nextCursor: null };
    tbody.replaceChildren();
    document.getElementById('ctx-table').hidden = true;
    document.getElementById('ctx-empty').hidden = true;
    moreBox.hidden = true;
    txSection.hidden = false;
    loadHistory();
    txSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  moreButton.addEventListener('click', () => { if (current?.nextCursor) loadHistory(current.nextCursor); });

  async function load() {
    const loading = document.getElementById('closed-loading');
    try {
      const closed = (await api.listAccounts({ includeHidden: true })).items.filter((a) => a.status === 'CLOSED');
      // 예적금 계좌 → 가입 정보(해지일, 상세 링크). 실패해도 계좌 목록은 보여 준다.
      const subscriptionByAccount = new Map();
      if (closed.length) {
        try {
          (await api.listSavings()).items.forEach((s) => subscriptionByAccount.set(s.accountId, s));
        } catch (err) {
          if (err.handled) return;
        }
      }
      document.getElementById('closed-body').replaceChildren(...closed.map((a) => {
        const sub = subscriptionByAccount.get(a.accountId);
        const historyButton = el('button', { type: 'button', className: 'button small', textContent: '거래내역' });
        historyButton.addEventListener('click', () => showHistory(a, sub?.closedOn));
        return el('tr', {}, [
          el('td', { textContent: ACCOUNT_TYPE_LABELS[a.accountType] ?? a.accountType }),
          el('td', { textContent: a.preferences?.alias || a.accountName }),
          el('td', {}, [el('span', { className: 'mono', textContent: a.number })]), // td.mono는 말줄임 규칙이 있어 span에 둔다
          el('td', { textContent: formatDate(kstDate.format(new Date(a.openedAt))) }),
          el('td', { textContent: sub?.closedOn ? formatDate(sub.closedOn) : '-' }),
          el('td', {}, [historyButton]),
          el('td', {}, [sub ? el('a', { href: savingsDetailLink(sub.subscriptionId), textContent: '해지 내역' }) : '-']),
        ]);
      }));
      document.getElementById('closed-count').textContent = `총 ${closed.length}건`;
      document.getElementById('closed-table').hidden = closed.length === 0;
      document.getElementById('closed-empty').hidden = closed.length !== 0;
    } catch (err) {
      showApiError(listSection, err);
    } finally {
      loading.hidden = true;
    }
  }

  load();
}
