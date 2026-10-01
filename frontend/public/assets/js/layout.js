// 모든 페이지가 불러오는 공통 스크립트: 로그인 필요 페이지 보호, 헤더 로그인 상태, 모바일 메뉴, 깡통 조회 결과.
// GNB·푸터 HTML 자체는 site/build.mjs가 미리 생성해 두므로 여기서 만들지 않는다.

import { getToken, getUsername, logout, redirectToLogin } from './session.js';

// 로그인 필요 여부는 사이트맵의 auth 값이 <meta name="pb-auth">로 들어온다.
// 화면 이동만 막을 뿐이다. HTML은 누구나 받을 수 있고, 데이터는 서버의 401·404가 보호한다.
if (document.querySelector('meta[name="pb-auth"]')?.content === 'required' && !getToken()) {
  redirectToLogin();
} else {
  init();
}

function init() {
  const member = Boolean(getToken());
  document.querySelectorAll('[data-when]').forEach((node) => {
    node.hidden = (node.dataset.when === 'member') !== member;
  });
  document.querySelectorAll('[data-username]').forEach((node) => { node.textContent = getUsername(); });
  document.querySelectorAll('[data-logout]').forEach((button) => button.addEventListener('click', logout));

  // 좁은 화면의 전체메뉴 버튼
  const toggle = document.querySelector('.gnb-toggle');
  const header = document.querySelector('.site-header');
  toggle?.addEventListener('click', () => {
    const open = header.classList.toggle('gnb-open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  // 깡통 조회·검색 폼: 조건을 넣고 제출하면(쿼리가 있으면) 결과 없음 문구로 바꾼다.
  if (location.search) {
    document.querySelectorAll('[data-stub-result]').forEach((node) => { node.textContent = node.dataset.stubResult; });
  }
}
