// 표시 형식. 서버 값을 가공만 하고 계산하지 않는다.

import { groupMoney } from './money.js';

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short',
});

// 원장 상대방이 계좌번호가 아닌 특수 값 (백엔드 LedgerEntry.counterparty)
const COUNTERPARTY_LABELS = {
  SIMULATED_CASH_DEPOSIT: '시연용 가상 입금',
  SIMULATED_SAVINGS_INTEREST: '모의 예적금 이자',
};

// 금액은 서버가 준 십진 문자열을 그대로 자릿수만 끊어 표시한다(Number 변환 없음).
export function formatAmount(amount) {
  return `${groupMoney(amount)}원`;
}

// 거래내역용: 부호는 금액 값이 아니라 direction(DEPOSIT/WITHDRAWAL)으로 정한다.
export function formatSignedAmount(amount, direction) {
  const abs = String(amount ?? '').replace(/^-/, '');
  return `${direction === 'DEPOSIT' ? '+' : '-'}${formatAmount(abs)}`;
}

export const directionLabel = (direction) => (direction === 'DEPOSIT' ? '입금' : '출금');

const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i;

// 시각은 시간대가 붙은 ISO 문자열이 계약이다.
// 오프셋이 없으면 new Date()가 로컬 시각으로 해석해 9시간 어긋나므로 콘솔에 보고한다.
export function formatDateTime(isoString) {
  if (typeof isoString !== 'string') return '-';
  if (!OFFSET_RE.test(isoString)) {
    console.warn('[format] 시각에 시간대 오프셋이 없습니다. 계약 위반이므로 백엔드에 보고해야 합니다:', isoString);
  }
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? isoString : dateFormat.format(date);
}

// YYYY-MM-DD(한국 날짜)는 시간대 변환 없이 그대로 보여 준다.
export const formatDate = (day) => (typeof day === 'string' && day ? day.replaceAll('-', '.') : '-');

// 남은 시간 mm:ss
export function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function formatCounterparty(counterparty) {
  return COUNTERPARTY_LABELS[counterparty] ?? counterparty;
}

// "0.030000" → "3.00%" (문자열 자리 이동, 부동소수점 계산 없음)
export function formatRate(rate) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(rate ?? ''));
  if (!m) return String(rate ?? '-');
  const frac = (m[2] || '').padEnd(4, '0');
  const int = String(Number(m[1] + frac.slice(0, 2))); // 앞자리 0 제거
  return `${int}.${frac.slice(2, 4)}%`;
}

export const ACCOUNT_TYPE_LABELS = {
  CHECKING: '입출금',
  TERM_DEPOSIT: '예금',
  INSTALLMENT_SAVINGS: '적금',
};

// 국내 번호(+8210…, 010…)는 010-1234-5678로, 그 밖은 그대로 표시한다.
export function formatPhone(phone) {
  const local = String(phone ?? '').replace(/^\+82/, '0');
  const m = /^(01\d)(\d{3,4})(\d{4})$/.exec(local);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : (phone ?? '');
}
