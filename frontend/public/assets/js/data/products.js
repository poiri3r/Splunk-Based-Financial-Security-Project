// 예금·적금 상품 (시연용 예시). 필드 이름은 백엔드 요청 문서(10.02 합의 사항 3-5)의 GET /api/products 가안과 같다.
// 백엔드 상품 목록 API가 생기면 화면은 이 파일 대신 API를 읽도록 바꾼다.
// 목 서버도 이 파일로 가입 요청(상품 존재, 금액·기간 범위)을 검증한다.
//
// minAmount / maxAmount 단위는 원. 적금은 월 납입액 기준이다. maxAmount가 null이면 상한 없음.

export const PRODUCT_TYPES = {
  DEPOSIT: { label: '예금', amountLabel: '가입 금액' },
  SAVINGS: { label: '적금', amountLabel: '월 납입액' },
};

export const PRODUCTS = [
  {
    productId: 'DEP-001', type: 'DEPOSIT', tag: '대표', name: 'Project 정기예금',
    description: '만기까지 확정 금리를 받는 기본 정기예금', rate: 3.2, minTermMonths: 1, maxTermMonths: 36,
    minAmount: 1000000, maxAmount: null,
  },
  {
    productId: 'DEP-002', type: 'DEPOSIT', tag: '비대면', name: 'Project 스마트 예금',
    description: '인터넷뱅킹 전용 우대 금리 예금', rate: 3.35, minTermMonths: 6, maxTermMonths: 24,
    minAmount: 100000, maxAmount: null,
  },
  {
    productId: 'SAV-001', type: 'SAVINGS', tag: '대표', name: 'Project 정기적금',
    description: '매월 같은 날 같은 금액을 저축하는 적금', rate: 3.5, minTermMonths: 6, maxTermMonths: 36,
    minAmount: 10000, maxAmount: 3000000,
  },
  {
    productId: 'SAV-002', type: 'SAVINGS', tag: '자유', name: 'Project 자유적금',
    description: '원하는 날 원하는 금액을 저축하는 적금', rate: 3.3, minTermMonths: 6, maxTermMonths: 24,
    minAmount: 10000, maxAmount: 1000000,
  },
  {
    productId: 'SAV-003', type: 'SAVINGS', tag: '청년', name: 'Project 청년 도약적금',
    description: '만 19~34세 대상 우대 금리 적금', rate: 4.0, minTermMonths: 12, maxTermMonths: 36,
    minAmount: 10000, maxAmount: 700000,
  },
];

// 가입 기간 선택지(개월). 상품의 최소~최대 범위 안의 값만 쓴다.
export const TERM_CHOICES = [1, 3, 6, 12, 24, 36];

export const findProduct = (productId) => PRODUCTS.find((p) => p.productId === productId) ?? null;
export const termsOf = (product) => TERM_CHOICES.filter((m) => m >= product.minTermMonths && m <= product.maxTermMonths);
