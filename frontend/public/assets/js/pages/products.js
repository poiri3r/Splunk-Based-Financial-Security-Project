// 예금·적금 상품 목록 (작업 요청서 R5). 어느 종류를 보일지는 <body data-product-type>으로 정한다.
// 상품은 서버 GET /api/v2/savings-products(공개)에서 읽는다. 로그인 없이 볼 수 있다.
import { api } from '../api.js';
import { formatAmount, formatRate } from '../format.js';
import { el, showApiError } from '../ui.js';
import { ROUTES } from '../routes.js';
import { PAGE_TYPES, amountLabel, isInstallment } from '../savings.js';

const accountType = PAGE_TYPES[document.body.dataset.productType];
const list = document.getElementById('product-list');
const errorBox = document.getElementById('product-error');

async function load() {
  try {
    const products = (await api.savingsProducts()).filter((p) => p.accountType === accountType);
    list.replaceChildren(...products.map((p) => el('li', { className: 'product-card' }, [
      el('span', { className: 'product-tag', textContent: '모의 상품' }),
      el('h2', { textContent: p.name }),
      el('p', { textContent: p.termsText }),
      el('dl', {}, [
        el('dt', { textContent: '연 금리' }), el('dd', { textContent: formatRate(p.annualRate) }),
        el('dt', { textContent: '중도해지 금리' }), el('dd', { textContent: formatRate(p.earlyRate) }),
        el('dt', { textContent: '가입기간' }), el('dd', { textContent: `${p.months}개월 (고정)` }),
        el('dt', { textContent: amountLabel(p.accountType) }),
        el('dd', { textContent: `${isInstallment(p.accountType) ? '매회 ' : ''}${formatAmount(p.minimum)} ~ ${formatAmount(p.maximum)}` }),
      ]),
      el('a', { className: 'button primary', href: `${ROUTES.productJoin}?product=${encodeURIComponent(p.productId)}`, textContent: '가입하기' }),
    ])));
    if (products.length === 0) list.replaceChildren(el('li', { className: 'empty-state', textContent: '현재 가입할 수 있는 상품이 없습니다.' }));
  } catch (err) {
    errorBox.hidden = false;
    showApiError(errorBox.parentElement, err);
  } finally {
    document.getElementById('product-loading').hidden = true;
  }
}

load();
