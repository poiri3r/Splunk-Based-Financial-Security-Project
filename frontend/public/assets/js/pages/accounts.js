// 전체계좌조회 (작업 요청서 A4). 목록에는 입출금뿐 아니라 예금·적금·해지 계좌가 함께 온다.
// - 조회·설정 링크는 계좌 UUID(accountId), 화면 표시는 계좌번호(number)
// - 종류·상태에 맞는 버튼만 보인다. 예적금 계좌에는 송금·가상 입금 대신 상품 상세를 연결한다.
// - 버튼 노출은 편의일 뿐이며 최종 거래 허용 여부는 서버가 판단한다.
import { api } from '../api.js';
import { requireAuth } from '../session.js';
import { formatAmount, ACCOUNT_TYPE_LABELS } from '../format.js';
import {
  clearErrors, showApiError, el, transferLink, transactionsLink, depositLink, manageLink, savingsDetailLink, pinResetLink,
} from '../ui.js';

if (requireAuth()) init();

function init() {
  const section = document.getElementById('accounts-section');
  const list = document.getElementById('account-list');
  const loading = document.getElementById('accounts-loading');
  const empty = document.getElementById('accounts-empty');
  const count = document.getElementById('accounts-count');
  const refreshButton = document.getElementById('refresh-accounts');

  const button = (text, href, primary = false) =>
    el('a', { className: `button small${primary ? ' primary' : ''}`, href, textContent: text });

  function statusTags(a) {
    const tags = [];
    if (a.status !== 'ACTIVE') tags.push(el('span', { className: 'tag out', textContent: a.status === 'CLOSED' ? '해지' : a.status }));
    const p = a.preferences || {};
    if (a.accountType === 'CHECKING' && a.status === 'ACTIVE') {
      if (p.pinLocked) tags.push(el('span', { className: 'tag out', textContent: '비밀번호 잠김' }));
      else if (!p.pinConfigured) tags.push(el('span', { className: 'tag out', textContent: '비밀번호 미등록' }));
      if (!p.debitEnabled) tags.push(el('span', { className: 'tag out', textContent: '출금 해제' }));
    }
    return tags;
  }

  function actionsOf(a, subscriptionByAccount) {
    const actions = [button('거래내역', transactionsLink(a.accountId))];
    if (a.status !== 'ACTIVE') return actions; // 해지 계좌는 조회만
    if (a.accountType === 'CHECKING') {
      if (a.preferences?.pinLocked) actions.push(button('비밀번호 재설정', pinResetLink(a.accountId)));
      actions.push(button('관리', manageLink(a.accountId)));
      actions.push(button('가상 입금', depositLink(a.accountId)));
      actions.push(button('이체', transferLink(a.accountId), true));
    } else {
      const subscriptionId = subscriptionByAccount.get(a.accountId);
      if (subscriptionId) actions.push(button('상품 상세·해지', savingsDetailLink(subscriptionId), true));
    }
    return actions;
  }

  function renderAccounts(accounts, subscriptionByAccount) {
    list.replaceChildren(...accounts.map((a) => el('li', { className: `account${a.status !== 'ACTIVE' ? ' closed' : ''}` }, [
      el('div', { className: 'account-info' }, [
        el('span', { className: 'account-type', textContent: `${ACCOUNT_TYPE_LABELS[a.accountType] ?? a.accountType} · ${a.accountName}` }),
        a.preferences?.alias ? el('strong', { className: 'account-alias', textContent: a.preferences.alias }) : '',
        el('span', { className: 'account-number', textContent: a.number }),
        el('span', { className: 'balance', textContent: formatAmount(a.balance) }),
        a.accountType === 'CHECKING' && a.status === 'ACTIVE'
          ? el('span', { className: 'muted small', textContent: `출금 가능액 ${formatAmount(a.availableBalance)}` }) : '',
        el('span', { className: 'tags' }, statusTags(a)),
      ]),
      el('div', { className: 'actions' }, actionsOf(a, subscriptionByAccount)),
    ])));
    count.textContent = `총 ${accounts.length}개`;
    empty.hidden = accounts.length !== 0;
  }

  async function loadAccounts() {
    clearErrors(section);
    loading.hidden = false;
    refreshButton.disabled = true;
    try {
      const { items } = await api.listAccounts();
      // 예적금 계좌 → 가입 ID (상세 화면 링크용). 실패해도 계좌 목록은 보여 준다.
      const subscriptionByAccount = new Map();
      if (items.some((a) => a.accountType !== 'CHECKING')) {
        try {
          (await api.listSavings()).items.forEach((s) => subscriptionByAccount.set(s.accountId, s.subscriptionId));
        } catch (err) {
          if (err.handled) return;
        }
      }
      renderAccounts(items, subscriptionByAccount);
      document.getElementById('hidden-hint').hidden = false;
    } catch (err) {
      showApiError(section, err);
    } finally {
      loading.hidden = true;
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener('click', loadAccounts);
  loadAccounts();
}
