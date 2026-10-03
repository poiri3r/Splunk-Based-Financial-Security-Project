// 화면 코드가 이동하는 경로. 끝 슬래시를 붙인 정식 경로만 쓴다.
// 폴더/index.html 구조라 슬래시가 없으면 서버가 301로 한 번 돌려보낸다.
// site/build.mjs가 여기 있는 경로가 사이트맵에 있는지 검사한다.

export const ROUTES = {
  home: '/',
  login: '/login/',
  loginUnlock: '/login-unlock/',
  join: '/join/',
  findId: '/find-id/',
  findPw: '/find-pw/',
  accounts: '/inquiry/accounts/',
  transactions: '/inquiry/transactions/',
  manage: '/inquiry/manage/',
  transfer: '/transfer/instant/',
  transferResult: '/transfer/result/',
  transferLimit: '/transfer/limit/',
  beneficiaries: '/transfer/beneficiaries/',
  depositSim: '/deposit-sim/',
  openAccount: '/products/open/',
  productJoin: '/products/join/',
  subscriptions: '/inquiry/products/',
  savingsDetail: '/inquiry/products/detail/',
  profile: '/mypage/profile/',
  password: '/mypage/password/',
  pinReset: '/mypage/pin-reset/',
  recoveryCodes: '/mypage/recovery-codes/',
};
