// 예금·적금 상품 목록. 어느 종류를 보일지는 <body data-product-type>으로 정한다.
// 로그인 없이 볼 수 있다. 가입하기를 누르면 가입 페이지(로그인 필요)로 이동한다.
import { PRODUCTS, PRODUCT_TYPES } from '../data/products.js';
import { el } from '../ui.js';
import { ROUTES } from '../routes.js';

const type = document.body.dataset.productType;
const won = (n) => `${n.toLocaleString('ko-KR')}원`;

function amountText(p) {
  const range = p.maxAmount === null ? `${won(p.minAmount)} 이상` : `${won(p.minAmount)} ~ ${won(p.maxAmount)}`;
  return p.type === 'SAVINGS' ? `월 ${range}` : range;
}

document.getElementById('product-list').replaceChildren(...PRODUCTS.filter((p) => p.type === type).map((p) => (
  el('li', { className: 'product-card' }, [
    el('span', { className: 'product-tag', textContent: p.tag }),
    el('h2', { textContent: p.name }),
    el('p', { textContent: p.description }),
    el('dl', {}, [
      el('dt', { textContent: '기본금리' }), el('dd', { textContent: `연 ${p.rate.toFixed(2)}%` }),
      el('dt', { textContent: '가입기간' }), el('dd', { textContent: `${p.minTermMonths} ~ ${p.maxTermMonths}개월` }),
      el('dt', { textContent: PRODUCT_TYPES[p.type].amountLabel }), el('dd', { textContent: amountText(p) }),
    ]),
    el('a', { className: 'button primary', href: `${ROUTES.productJoin}?product=${encodeURIComponent(p.productId)}`, textContent: '가입하기' }),
  ])
)));
