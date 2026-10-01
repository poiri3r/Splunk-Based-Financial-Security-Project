// HTML 조각 생성. 모든 문자열은 esc()를 거친다(사이트맵 값이라도 예외 없음).

import { SITE_NAME, CATEGORIES, STANDALONE, QUICK_LINKS } from './sitemap.mjs';

export const GENERATED_MARK = '<!-- 자동 생성 파일: frontend/site/sitemap.mjs를 고치고 npm run build로 다시 만든다. 직접 수정하지 말 것. -->';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESC[c]);

// 링크는 끝 슬래시를 붙인다. 폴더/index.html 구조라 슬래시가 없으면 서버가 301로 돌려 요청이 두 번 생긴다.
export const href = (path) => (path === '/' ? '/' : `${path}/`);

const link = (path, text, attrs = '') => `<a href="${esc(href(path))}"${attrs}>${esc(text)}</a>`;

// 메뉴에 보이는 하위 페이지 (nav: false 제외)
const menuOf = (category) => category.children.filter((child) => child.nav !== false);

// ---------------------------------------------------------------------------
// 사이트맵 → 페이지 목록

export function allPages() {
  const pages = [];
  for (const category of CATEGORIES) {
    pages.push({ title: category.title, path: category.path, desc: category.desc, layout: 'sub', status: 'stub', stub: 'hub', category });
    for (const child of category.children) pages.push({ layout: 'sub', stub: 'notice', ...child, category });
  }
  for (const page of STANDALONE) pages.push({ stub: 'notice', ...page });
  return pages;
}

// ---------------------------------------------------------------------------
// 공통 구간 (layout:*)

export function headRegion(page) {
  const title = page.path === '/' ? `${SITE_NAME} - 개인뱅킹` : `${page.title} | ${SITE_NAME}`;
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<meta name="pb-auth" content="${page.auth ? 'required' : 'none'}">`,
    '<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">',
    '<link rel="stylesheet" href="/assets/css/style.css">',
    '<link rel="stylesheet" href="/assets/css/layout.css">',
    '<script type="module" src="/assets/js/layout.js"></script>',
  ].join('\n');
}

export function headerRegion(page) {
  const gnbItems = CATEGORIES.filter((c) => c.gnb).map((category) => {
    const current = page.category === category ? ' aria-current="true"' : '';
    const subs = menuOf(category).map((child) => `<li>${link(child.path, child.title)}</li>`).join('');
    return `<li class="gnb-item">${link(category.path, category.title, ` class="gnb-link"${current}`)}<ul class="gnb-sub">${subs}</ul></li>`;
  }).join('\n');

  return `<a class="skip-link" href="#main">본문 바로가기</a>
<header class="site-header" id="top">
<div class="util-bar"><div class="inner">
<ul class="segment" aria-label="고객 구분">
<li>${link('/', '개인', page.path === '/corporate' ? '' : ' aria-current="true"')}</li>
<li>${link('/corporate', '기업', page.path === '/corporate' ? ' aria-current="true"' : '')}</li>
</ul>
<ul class="util-links">
<li data-when="guest">${link('/login', '로그인')}</li>
<li data-when="guest">${link('/join', '회원가입')}</li>
<li data-when="member" hidden><span class="util-user"><strong data-username></strong>님</span></li>
<li data-when="member" hidden><button type="button" class="link-button" data-logout>로그아웃</button></li>
<li>${link('/support', '고객센터')}</li>
<li>${link('/security', '보안센터')}</li>
<li>${link('/sitemap', '사이트맵')}</li>
</ul>
</div></div>
<div class="gnb-bar"><div class="inner">
<a class="logo" href="/"><span class="logo-mark" aria-hidden="true">P</span><span class="logo-text">${esc(SITE_NAME)}</span></a>
<button type="button" class="gnb-toggle" aria-expanded="false" aria-controls="gnb">전체메뉴</button>
<nav class="gnb" id="gnb" aria-label="주 메뉴"><ul class="gnb-list">
${gnbItems}
</ul></nav>
</div></div>
</header>`;
}

export function lnbRegion(page) {
  const category = page.category;
  const items = menuOf(category).map((child) => {
    const current = child.path === page.path ? ' aria-current="page"' : '';
    return `<li>${link(child.path, child.title, current)}</li>`;
  }).join('\n');
  return `<aside class="lnb" aria-label="${esc(category.title)} 메뉴">
<h2 class="lnb-title">${link(category.path, category.title)}</h2>
<ul class="lnb-list">
${items}
</ul>
</aside>`;
}

export function pageHeadRegion(page) {
  const crumbs = [`<li>${link('/', '홈')}</li>`];
  if (page.category && page.category.path !== page.path) crumbs.push(`<li>${link(page.category.path, page.category.title)}</li>`);
  crumbs.push(`<li aria-current="page">${esc(page.title)}</li>`);
  const desc = page.desc ? `\n<p class="page-desc">${esc(page.desc)}</p>` : '';
  return `<nav class="breadcrumb" aria-label="현재 위치"><ol>${crumbs.join('')}</ol></nav>
<h1 class="page-title">${esc(page.title)}</h1>${desc}`;
}

export function footerRegion() {
  const columns = CATEGORIES.filter((c) => c.gnb).map((category) => {
    const items = menuOf(category).map((child) => `<li>${link(child.path, child.title)}</li>`).join('');
    return `<div class="footer-col"><h2>${link(category.path, category.title)}</h2><ul>${items}</ul></div>`;
  }).join('\n');
  const quick = QUICK_LINKS.map((q) => `<li>${link(q.path, q.title)}</li>`).join('');

  return `<footer class="site-footer">
<div class="footer-top"><div class="inner">
<ul class="footer-links">
<li>${link('/terms', '이용약관')}</li>
<li class="strong">${link('/privacy', '개인정보처리방침')}</li>
<li>${link('/guide/e-finance', '전자금융거래 이용안내')}</li>
<li>${link('/security', '보안센터')}</li>
<li>${link('/support', '고객센터')}</li>
<li>${link('/sitemap', '사이트맵')}</li>
</ul>
</div></div>
<div class="inner">
<nav class="footer-menu" aria-label="전체 메뉴">
${columns}
</nav>
<div class="footer-info">
<p class="footer-demo"><strong>시연용 가상 은행</strong> ${esc(SITE_NAME)}는 보안 관제 프로젝트를 위해 만든 가상의 은행이며 실제 금융기관이 아닙니다. 실제 금융 정보나 개인정보를 입력하지 마세요.</p>
<p>고객센터 0000-0000 (시연용 가상 번호) · © 2026 ${esc(SITE_NAME)} (Demo)</p>
</div>
</div>
</footer>
<nav class="quickbar" aria-label="퀵메뉴">
<p class="quickbar-title">QUICK</p>
<ul>${quick}</ul>
<a class="quickbar-top" href="#top">TOP</a>
</nav>`;
}

// 메인 공지사항: 고객센터 공지사항 게시판의 최근 글
export function homeNoticeRegion() {
  const board = CATEGORIES.flatMap((c) => c.children).find((p) => p.path === '/support/notice');
  return (board.posts || []).slice(0, 4).map((post) =>
    `<li>${link(board.path, post.title)}<time datetime="${esc(post.date)}">${esc(post.date.replaceAll('-', '.'))}</time></li>`,
  ).join('\n');
}

// ---------------------------------------------------------------------------
// 깡통 화면 본문

function noticeBody(page) {
  const back = page.category ? link(page.category.path, `${page.category.title} 메뉴로`, ' class="button"') : '';
  return `<section class="panel stub-notice">
<p class="stub-badge">서비스 준비 중</p>
<h2>${esc(page.title)} 서비스를 준비하고 있습니다</h2>
<p>더 나은 서비스를 위해 준비 중입니다. 이용에 불편을 드려 죄송합니다.</p>
<p class="muted">문의: 고객센터 0000-0000 (시연용 가상 번호)</p>
<div class="actions">${back}${link('/', '홈으로', ' class="button primary"')}</div>
</section>`;
}

// 조회 폼은 GET으로 실제 제출된다. 서버 접근 로그에 조회 조건이 남도록 하기 위함이다(결과는 항상 없음).
function inquiryBody(page) {
  return `<form class="panel inquiry-form" method="get" action="${esc(href(page.path))}">
<div class="form-grid">
<div class="field"><label for="q-account">조회 계좌</label><select id="q-account" name="account"><option value="">계좌를 선택하세요</option></select></div>
<div class="field"><label for="q-from">조회 기간</label><div class="date-range"><input id="q-from" type="date" name="from" aria-label="시작일"><span aria-hidden="true">~</span><input type="date" name="to" aria-label="종료일"></div></div>
</div>
<div class="actions end"><button type="submit" class="button primary">조회</button></div>
</form>
<section class="panel">
<h2 class="section-title">조회 결과</h2>
<p class="empty-state" data-stub-result="조회된 내역이 없습니다.">조회 조건을 선택한 뒤 조회 버튼을 눌러 주세요.</p>
</section>`;
}

function boardBody(page) {
  const posts = page.posts || [];
  const rows = posts.length
    ? posts.map((post, i) => `<tr><td class="num">${posts.length - i}</td><td class="title">${esc(post.title)}</td><td>${esc(post.date.replaceAll('-', '.'))}</td></tr>`).join('\n')
    : '<tr><td colspan="3" class="empty-state" data-stub-result="검색 결과가 없습니다.">등록된 게시물이 없습니다.</td></tr>';
  return `<form class="board-search" method="get" action="${esc(href(page.path))}">
<select name="field" aria-label="검색 항목"><option value="title">제목</option><option value="content">내용</option></select>
<input name="q" type="search" placeholder="검색어를 입력하세요" aria-label="검색어">
<button type="submit" class="button">검색</button>
</form>
<div class="table-wrap"><table class="board-table">
<thead><tr><th scope="col" class="num">번호</th><th scope="col">제목</th><th scope="col">등록일</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>
<nav class="pager" aria-label="페이지"><a href="${esc(href(page.path))}?page=1" aria-current="page">1</a></nav>`;
}

function docBody(page) {
  const articles = [
    ['목적', `이 문서는 ${SITE_NAME}(이하 "은행")가 제공하는 ${page.title}에 관한 기본 사항을 정합니다.`],
    ['정의', '이 문서에서 사용하는 용어의 뜻은 관계 법령과 은행의 약관에서 정한 바에 따릅니다.'],
    ['적용 범위', '이 문서는 은행의 인터넷뱅킹을 이용하는 모든 고객에게 적용됩니다.'],
    ['변경', '은행은 내용을 변경하는 경우 시행일 7일 전까지 홈페이지 공지사항에 게시합니다.'],
  ];
  const body = articles.map(([title, text], i) => `<h2>제${i + 1}조 (${esc(title)})</h2>\n<p>${esc(text)}</p>`).join('\n');
  return `<article class="panel doc">
<p class="notice warning">이 문서는 시연용 가상 은행의 예시 문서이며 실제 효력이 없습니다.</p>
${body}
<p class="muted">시행일: 2026년 10월 1일</p>
</article>`;
}

function hubBody(page) {
  const cards = menuOf(page.category).map((child) => {
    const badge = child.auth ? '<span class="badge">로그인 필요</span>' : '';
    return `<li><a class="hub-card" href="${esc(href(child.path))}"><strong>${esc(child.title)}</strong><span>${esc(child.desc || '')}</span>${badge}</a></li>`;
  }).join('\n');
  return `<ul class="hub-grid">
${cards}
</ul>`;
}

function sitemapBody() {
  const columns = CATEGORIES.map((category) => {
    const items = menuOf(category).map((child) => `<li>${link(child.path, child.title)}</li>`).join('');
    return `<section class="sitemap-col"><h2>${link(category.path, category.title)}</h2><ul>${items}</ul></section>`;
  });
  const etc = STANDALONE.filter((p) => !['/', '/sitemap'].includes(p.path))
    .map((p) => `<li>${link(p.path, p.title)}</li>`).join('');
  columns.push(`<section class="sitemap-col"><h2>회원</h2><ul>${etc}</ul></section>`);
  return `<div class="sitemap-grid">
${columns.join('\n')}
</div>`;
}

const STUB_BODIES = {
  notice: noticeBody, inquiry: inquiryBody, board: boardBody, doc: docBody,
  hub: hubBody, sitemap: sitemapBody,
};

// ---------------------------------------------------------------------------
// 깡통 페이지 전체 (구간은 비워 두고 build가 채운다)

export function stubPage(page) {
  const render = STUB_BODIES[page.stub];
  if (!render) throw new Error(`${page.path}: 알 수 없는 stub 종류 "${page.stub}"`);
  const body = render(page);

  const main = page.layout === 'sub'
    ? `<div class="sub-layout inner">
<!-- layout:lnb -->
<!-- /layout:lnb -->
<main class="sub-main" id="main">
<!-- layout:page-head -->
<!-- /layout:page-head -->
${body}
</main>
</div>`
    : `<main class="plain-main inner" id="main">
<!-- layout:page-head -->
<!-- /layout:page-head -->
${body}
</main>`;

  return `<!doctype html>
${GENERATED_MARK}
<html lang="ko">
<head>
<!-- layout:head -->
<!-- /layout:head -->
</head>
<body>
<!-- layout:header -->
<!-- /layout:header -->
${main}
<!-- layout:footer -->
<!-- /layout:footer -->
</body>
</html>
`;
}
