// 예금·적금 공통 표시 규칙 (작업 요청서 R5·A6). 상품 정보는 서버 GET /api/v2/savings-products가 원본이다.

// 상품 목록 페이지의 <body data-product-type> → 서버 accountType
export const PAGE_TYPES = { DEPOSIT: 'TERM_DEPOSIT', SAVINGS: 'INSTALLMENT_SAVINGS' };

export const isInstallment = (accountType) => accountType === 'INSTALLMENT_SAVINGS';

// 예금은 가입 금액, 적금은 매월 납입액
export const amountLabel = (accountType) => (isInstallment(accountType) ? '월 납입액' : '가입 금액');

// 가입 상태는 ACTIVE/CLOSED 두 가지다. 만기일이 지났다고 자동 해지되지 않으므로 '만기 도래'는 화면에서만 구분한다.
export function statusLabel(subscription, today) {
  if (subscription.status === 'CLOSED') return '해지';
  if (subscription.status === 'ACTIVE') return subscription.maturityOn <= today ? '만기 도래 (해지 가능)' : '정상';
  return subscription.status;
}

// 한국 날짜 YYYY-MM-DD (maturityOn 등과 같은 기준)
export function kstToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export const productNameOf = (products, productId) => products.find((p) => p.productId === productId)?.name ?? productId;
