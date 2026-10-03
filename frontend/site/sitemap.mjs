// 사이트맵: 사이트의 모든 페이지와 메뉴 구조를 정의하는 단일 원본.
// GNB, LNB, breadcrumb, 푸터, /sitemap 페이지, 깡통 페이지, 로그인 필요 여부가 모두 여기서 만들어진다.
// 수정 후에는 `npm run build`(또는 `npm run dev`)로 HTML을 다시 생성한다.
//
// 페이지 필드
//   path    끝 슬래시 없이 적는다. 파일은 public{path}/index.html, 링크는 끝 슬래시를 붙여 만든다.
//   status  live: 직접 작성한 페이지(실제 API 또는 목으로 동작). 생성기는 layout 구간만 교체한다.
//           stub: 깡통 페이지. 파일 전체를 생성기가 만든다(직접 수정 금지).
//   stub    깡통 화면 종류. notice(준비 중, 기본) | inquiry(빈 조회 폼) | board(게시판) | doc(약관 문서)
//   auth    true면 로그인 필요. 토큰이 없으면 /login/?next=<현재 경로>로 이동한다.
//   planned 나중에 실제 기능으로 바꿀 예정인 깡통의 메모 (화면에는 쓰이지 않음)
//   nav     false면 메뉴(GNB·LNB·푸터·메뉴 홈·사이트맵)에 표시하지 않는다. 다른 화면에서 링크로만 들어오는 페이지용

export const SITE_NAME = 'Project Bank';

// 대메뉴. gnb: true인 것만 상단 GNB와 푸터 메뉴에 나온다. path는 메뉴 홈(하위 메뉴 목록 페이지)이다.
export const CATEGORIES = [
  {
    title: '조회', path: '/inquiry', gnb: true,
    desc: '보유 계좌와 거래내역을 조회합니다.',
    children: [
      { title: '전체계좌조회', path: '/inquiry/accounts', status: 'live', auth: true, desc: '보유한 모든 계좌의 잔액을 확인합니다.' },
      { title: '거래내역조회', path: '/inquiry/transactions', status: 'live', auth: true, desc: '계좌별 입출금 내역을 기간·구분별로 확인합니다.' },
      { title: '계좌 관리', path: '/inquiry/manage', status: 'live', auth: true, desc: '계좌 별명·숨김·순서, 출금 등록, 계좌 비밀번호를 관리합니다.' },
      { title: '카드이용내역', path: '/inquiry/card', status: 'stub', stub: 'inquiry', auth: true, desc: '체크·신용카드 이용 내역을 조회합니다.' },
      { title: '대출조회', path: '/inquiry/loan', status: 'stub', stub: 'inquiry', auth: true, desc: '대출 잔액과 이자 납입 내역을 조회합니다.' },
      { title: '예금·적금 가입내역', path: '/inquiry/products', status: 'live', auth: true, desc: '가입한 예금·적금 상품을 확인합니다.' },
      { title: '예금·적금 상세', path: '/inquiry/products/detail', status: 'live', auth: true, nav: false, desc: '가입 상세, 적금 납입, 해지를 처리합니다.' },
      { title: '해지계좌조회', path: '/inquiry/closed', status: 'stub', stub: 'inquiry', auth: true, desc: '해지된 계좌의 과거 내역을 조회합니다.' },
      { title: '수표조회', path: '/inquiry/check', status: 'stub', stub: 'inquiry', desc: '자기앞수표의 정상 발행 여부를 확인합니다.' },
    ],
  },
  {
    title: '이체', path: '/transfer', gnb: true,
    desc: '계좌이체와 예약·자동이체를 이용합니다.',
    children: [
      { title: '즉시이체', path: '/transfer/instant', status: 'live', auth: true, desc: '다른 계좌로 바로 이체합니다.' },
      { title: '자주 쓰는 계좌', path: '/transfer/beneficiaries', status: 'live', auth: true, desc: '자주 보내는 계좌를 등록하고 관리합니다.' },
      { title: '예약이체', path: '/transfer/reserved', status: 'stub', auth: true, desc: '지정한 날짜와 시각에 이체합니다.' },
      { title: '자동이체', path: '/transfer/auto', status: 'stub', auth: true, desc: '정해진 날짜마다 같은 금액을 이체합니다.' },
      { title: '이체결과조회', path: '/transfer/result', status: 'live', auth: true, desc: '보낸 이체의 처리 결과를 확인합니다.' },
      { title: '이체한도 조회·변경', path: '/transfer/limit', status: 'live', auth: true, desc: '1회·1일 이체한도와 오늘 사용량을 확인하고 한도를 줄입니다.' },
      { title: '시연용 가상 입금', path: '/deposit-sim', status: 'live', auth: true, desc: '시연을 위해 내 계좌에 가상 금액을 입금합니다. 실제 입금이 아닙니다.' },
    ],
  },
  {
    title: '공과금', path: '/bills', gnb: true,
    desc: '지로, 세금, 관리비를 납부합니다.',
    children: [
      { title: '지로납부', path: '/bills/giro', status: 'stub', auth: true, desc: '지로번호로 각종 요금을 납부합니다.' },
      { title: '국세·지방세', path: '/bills/tax', status: 'stub', auth: true, desc: '국세와 지방세를 조회하고 납부합니다.' },
      { title: '아파트관리비', path: '/bills/apartment', status: 'stub', auth: true, desc: '아파트 관리비를 납부합니다.' },
      { title: '납부내역조회', path: '/bills/history', status: 'stub', stub: 'inquiry', auth: true, desc: '공과금 납부 내역을 확인합니다.' },
    ],
  },
  {
    title: '외환', path: '/fx', gnb: true,
    desc: '환율 조회, 환전, 해외송금을 이용합니다.',
    children: [
      { title: '환율조회', path: '/fx/rates', status: 'stub', desc: '통화별 고시 환율을 확인합니다.' },
      { title: '환전신청', path: '/fx/exchange', status: 'stub', auth: true, desc: '외화를 신청하고 영업점에서 받습니다.' },
      { title: '해외송금', path: '/fx/remittance', status: 'stub', auth: true, desc: '해외 계좌로 송금합니다.' },
      { title: '외화예금', path: '/fx/deposit', status: 'stub', desc: '외화로 예금하는 상품을 안내합니다.' },
    ],
  },
  {
    title: '금융상품', path: '/products', gnb: true,
    desc: '예금, 적금, 대출 등 금융상품을 안내합니다.',
    children: [
      // 예금·적금 상품은 백엔드 GET /api/v2/savings-products(공개)에서 읽는다.
      { title: '예금', path: '/products/deposit', status: 'live', desc: '목돈을 맡기고 이자를 받는 상품입니다.' },
      { title: '적금', path: '/products/savings', status: 'live', desc: '매월 일정 금액을 모으는 상품입니다.' },
      { title: '상품 가입', path: '/products/join', status: 'live', auth: true, nav: false, desc: '예금·적금 상품에 가입합니다.' },
      { title: '펀드', path: '/products/fund', status: 'stub', desc: '투자 성향에 맞는 펀드를 안내합니다.' },
      { title: '대출', path: '/products/loan', status: 'stub', desc: '신용·담보 대출 상품을 안내합니다.' },
      { title: '신탁', path: '/products/trust', status: 'stub', desc: '자산을 맡겨 운용하는 신탁 상품을 안내합니다.' },
      { title: '보험', path: '/products/insurance', status: 'stub', desc: '방카슈랑스 보험 상품을 안내합니다.' },
      { title: 'ISA', path: '/products/isa', status: 'stub', desc: '개인종합자산관리계좌를 안내합니다.' },
      { title: '계좌개설', path: '/products/open', status: 'live', auth: true, desc: '새 입출금 계좌를 개설합니다.' },
    ],
  },
  {
    // 시세조회: 카카오맵 + 임시 시세 데이터(프론트 정적 파일). 시세 API는 백엔드 선택 사항.
    title: '부동산', path: '/realestate', gnb: true,
    desc: '부동산 시세와 관련 금융 정보를 안내합니다.',
    children: [
      { title: '시세조회', path: '/realestate/price', status: 'live', desc: '지역별 아파트 평균 시세를 지도에서 확인합니다.' },
      { title: '부동산 대출 안내', path: '/realestate/loan', status: 'stub', desc: '주택담보대출과 전세자금대출을 안내합니다.' },
    ],
  },
  {
    title: '마이페이지', path: '/mypage', gnb: true,
    desc: '내 정보와 보안 설정을 관리합니다.',
    children: [
      { title: '내 정보 조회·변경', path: '/mypage/profile', status: 'live', auth: true, desc: '이름, 연락처 등 내 정보를 확인하고 변경합니다.' },
      { title: '비밀번호 변경', path: '/mypage/password', status: 'live', auth: true, desc: '로그인 비밀번호를 변경합니다.' },
      { title: '계좌 비밀번호 재설정', path: '/mypage/pin-reset', status: 'live', auth: true, desc: '잊어버렸거나 잠긴 계좌 비밀번호를 다시 설정합니다.' },
      { title: '복구 코드 관리', path: '/mypage/recovery-codes', status: 'live', auth: true, desc: '계정 복구에 쓰는 일회용 복구 코드를 발급합니다.' },
      { title: '약관 동의 내역', path: '/mypage/terms', status: 'live', auth: true, desc: '가입할 때 동의한 약관과 버전을 확인합니다.' },
      // 접속 기록·회원탈퇴는 백엔드 v6에 없다(추가 협의 C4: 후속 범위). API 계약이 생기면 live로 되돌린다.
      { title: '접속 기록', path: '/mypage/login-history', status: 'stub', auth: true, planned: 'C4 후속 범위', desc: '최근 로그인 일시와 접속 환경을 확인합니다.' },
      { title: '회원탈퇴', path: '/mypage/withdraw', status: 'stub', auth: true, planned: 'C4 후속 범위', desc: '인터넷뱅킹 서비스를 해지합니다.' },
    ],
  },
  {
    title: '고객센터', path: '/support', gnb: false,
    desc: '공지사항과 자주 묻는 질문을 확인합니다.',
    children: [
      {
        title: '공지사항', path: '/support/notice', status: 'stub', stub: 'board', desc: 'Project Bank의 새 소식을 알려드립니다.',
        posts: [
          { title: '[시연] 인터넷뱅킹 시스템 정기 점검 안내', date: '2026-09-30' },
          { title: '전자금융거래 이용약관 개정 안내', date: '2026-09-24' },
          { title: 'Project 정기예금 우대 금리 이벤트', date: '2026-09-18' },
          { title: '개인정보처리방침 변경 사전 안내', date: '2026-09-10' },
          { title: '추석 연휴 영업점 운영 안내', date: '2026-09-01' },
        ],
      },
      { title: '자주 묻는 질문', path: '/support/faq', status: 'stub', stub: 'board', desc: '자주 문의하시는 내용을 모았습니다.' },
      { title: '1:1 문의', path: '/support/inquiry', status: 'stub', auth: true, desc: '궁금한 점을 남기면 답변해 드립니다.' },
      { title: '영업점 안내', path: '/support/branch', status: 'stub', desc: '가까운 영업점과 ATM 위치를 안내합니다.' },
    ],
  },
  {
    title: '보안센터', path: '/security', gnb: false,
    desc: '안전한 금융거래를 위한 보안 정보를 안내합니다.',
    children: [
      {
        title: '보안 공지', path: '/security/notice', status: 'stub', stub: 'board', desc: '금융사기 유형과 보안 공지를 알려드립니다.',
        posts: [
          { title: '검찰·금융기관 사칭 보이스피싱 주의', date: '2026-09-27' },
          { title: '택배 문자를 사칭한 스미싱 주의', date: '2026-09-15' },
          { title: '가짜 은행 사이트(파밍) 구별 방법', date: '2026-09-03' },
        ],
      },
      { title: '피싱·파밍 예방', path: '/security/phishing', status: 'stub', stub: 'doc', desc: '금융사기 수법과 예방 방법을 안내합니다.' },
      { title: '금융사고 신고', path: '/security/report', status: 'stub', desc: '피해가 의심되면 즉시 지급정지를 신청하세요.' },
      { title: '보안 프로그램', path: '/security/program', status: 'stub', desc: '인터넷뱅킹 보안 프로그램을 안내합니다.' },
    ],
  },
  {
    title: '이용안내', path: '/guide', gnb: false,
    desc: '약관과 개인정보처리방침을 안내합니다.',
    children: [
      { title: '이용약관', path: '/terms', status: 'stub', stub: 'doc', desc: '인터넷뱅킹 서비스 이용약관입니다.' },
      { title: '개인정보처리방침', path: '/privacy', status: 'stub', stub: 'doc', desc: '개인정보의 수집·이용·보관 기준입니다.' },
      { title: '전자금융거래 이용안내', path: '/guide/e-finance', status: 'stub', stub: 'doc', desc: '전자금융거래 기본약관과 이용 방법입니다.' },
    ],
  },
];

// 대메뉴에 속하지 않는 페이지. layout: home(메인) | plain(LNB 없음)
export const STANDALONE = [
  { title: '홈', path: '/', layout: 'home', status: 'live' },
  { title: '로그인', path: '/login', layout: 'plain', status: 'live' },
  { title: '회원가입', path: '/join', layout: 'plain', status: 'live' },
  { title: '아이디 찾기', path: '/find-id', layout: 'plain', status: 'live' },
  { title: '비밀번호 재설정', path: '/find-pw', layout: 'plain', status: 'live' },
  { title: '로그인 잠금 해제', path: '/login-unlock', layout: 'plain', status: 'live' },
  { title: '기업뱅킹', path: '/corporate', layout: 'plain', status: 'stub' },
  { title: '사이트맵', path: '/sitemap', layout: 'plain', status: 'stub', stub: 'sitemap' },
];

// 우측 퀵바와 메인 퀵메뉴에 쓰는 바로가기
export const QUICK_LINKS = [
  { title: '계좌조회', path: '/inquiry/accounts' },
  { title: '거래내역', path: '/inquiry/transactions' },
  { title: '즉시이체', path: '/transfer/instant' },
  { title: '환율조회', path: '/fx/rates' },
  { title: '고객센터', path: '/support' },
];
