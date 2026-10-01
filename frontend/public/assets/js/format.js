// 표시 형식. 서버 값을 가공만 하고 계산하지 않는다.

const amountFormat = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short',
});

export const SIMULATED_CASH_DEPOSIT = 'SIMULATED_CASH_DEPOSIT';

// JSON의 0.00은 JS에서 0이 되므로 소수 두 자리를 명시한다.
export function formatAmount(amount) {
  return `${amountFormat.format(amount)}원`;
}

// 부호 포함 표시 (거래내역용).
export function formatSignedAmount(amount) {
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${sign}${formatAmount(Math.abs(amount))}`;
}

const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i;

// createdAt은 Z가 붙은 UTC 문자열이 계약이다.
// 오프셋이 없으면 new Date()가 로컬 시각으로 해석해 9시간 어긋나므로 콘솔에 보고한다.
export function formatDateTime(isoString) {
  if (typeof isoString !== 'string') return '-';
  if (!OFFSET_RE.test(isoString)) {
    console.warn('[format] createdAt에 시간대 오프셋이 없습니다. 계약 위반이므로 백엔드에 보고해야 합니다:', isoString);
  }
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? isoString : dateFormat.format(date);
}

export function formatCounterparty(counterparty) {
  return counterparty === SIMULATED_CASH_DEPOSIT ? '시연용 가상 입금' : counterparty;
}

export function transactionKind(amount) {
  return amount > 0 ? '입금' : '출금';
}

// 01012345678 → 010-1234-5678 (형식이 다르면 그대로 표시)
export function formatPhone(phone) {
  const m = /^(01\d)(\d{3,4})(\d{4})$/.exec(phone ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : (phone ?? '');
}
