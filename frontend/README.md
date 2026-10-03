# Frontend

가상 은행 **Project Bank**의 웹 화면입니다. 프레임워크 없이 순수 HTML / CSS / JavaScript(ES Modules)로 작성했습니다.
화면은 **백엔드 v6 계약(`/api/v2`)**에 맞춰 동작합니다. 근거는 저장소의 `bank-backend-v6/` 문서 3종(작업 요청서 R1~R8·A1~A12, 흐름도, 추가 협의서 C1~C4)과 v6 ZIP의 Controller·DTO입니다.
메뉴 구성을 위한 준비 중 화면을 합쳐 71개 경로가 있습니다.

- 백엔드 v6에 없는 기능(접속 기록, 회원탈퇴, 부동산 시세 API, 계좌개설 부가 옵션)은 추가 협의 C4에 따라 **준비 중**이거나 화면에서 뺐습니다. 없는 API를 호출하지 않습니다.
- 부동산 시세는 정적 JSON + 카카오맵 시연 화면입니다(실제 시세 아님).

## 실행

Node.js LTS가 필요합니다.

```bash
cd frontend
npm install
npm run dev
```

브라우저에서 **`http://localhost:5500`** 으로 엽니다. `127.0.0.1`로 열면 저장 공간(sessionStorage)이 따로 잡히니 섞어 쓰지 마세요.

- `npm run dev`는 실행 전에 `npm run build`(HTML 생성)를 자동으로 먼저 돌립니다.
- `public/`만 웹에 노출됩니다. 디렉터리 목록은 표시하지 않습니다(`-d false`).
- 로컬에 없는 경로(`/api/...`, `/health`)는 `localhost:8080`의 백엔드로 전달됩니다.
- ES Module은 `file://`에서 동작하지 않으므로 HTML 파일을 더블클릭해서 열면 안 됩니다.

## 목(mock) 모드와 실제 서버

> **백엔드 담당자 참고:** 저장소에는 `USE_MOCK = true`로 올라가 있습니다. 백엔드 없이도 모든 화면이 동작하게 하기 위해서입니다.
> 목 서버(`public/mock/mock.js`)는 v6 Controller·DTO·Service를 읽고 흉내 낸 것이며 실서버 확인을 대신하지 않습니다(2026-10-03 v6 실서버로 브라우저 E2E 29개 항목 확인).

`public/assets/js/config.js`의 `USE_MOCK` 값으로 전환합니다. 다른 코드는 바꿀 필요가 없습니다.

| `USE_MOCK` | 동작 |
|---|---|
| `true` (현재) | 백엔드 없이 `public/mock/mock.js`가 응답합니다. 화면 오른쪽 아래에 MOCK 패널이 나타납니다. |
| `false` | 같은 PC의 8080에서 실행 중인 백엔드로 요청합니다. `http://localhost:5500/health` → `{"status":"ok"}`로 연결을 확인합니다. |

목 모드의 초기 데이터는 백엔드 v6 demo 프로필(`DemoData.java`)과 같습니다.

| 아이디 | 비밀번호 | 이름 | 휴대폰 | 계좌 | 계좌 비밀번호 | 초기 잔액 |
|---|---|---|---|---|---|---|
| alice | Demo!Alice7392 | 김시연 | +821090002951 | 2000000000000001 | 4826 | 100,000.00 |
| bob | Demo!Bob5837 | 이시연 | +821090002963 | 2000000000000002 | 7391 | 50,000.00 |

### 실서버(v6)로 확인하기

```bash
cd <bank-backendv6.zip 압축 해제 위치>/bank-backend
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export BANK_ENCRYPTION_KEY=$(openssl rand -base64 32) BANK_LOOKUP_KEY=$(openssl rand -base64 32)
export BANK_DEMO_INBOX_KEY=<32자 이상 무작위 값>   # 서버 전용. 프론트 코드·저장소에 넣지 않는다
mvn -q -DskipTests package
java -jar target/bank-backend-0.1.0.jar --spring.profiles.active=demo,demo-verification
```

`demo`는 시연 계좌·가상 입금, `demo-verification`은 모의 휴대폰 확인을 켭니다. 없으면 인증번호 요청이 503 `DELIVERY_DISABLED`로 막히고 회원가입·연락처 변경을 진행할 수 없습니다.

**모의 인증번호 확인 (추가 협의 C1 A안: 개발자 수동 확인).** 실제 문자는 발송되지 않습니다. 인증번호 요청 응답(브라우저 개발자 도구 Network 탭의 `POST /api/v2/contact-challenges`)에서 `challengeId`·`inboxToken`을 복사해 시연 담당자가 조회한 뒤 화면에 입력합니다.

```bash
curl -s localhost:8080/api/v2/demo/inbox -H 'Content-Type: application/json' \
  -H "X-Demo-Inbox-Key: $BANK_DEMO_INBOX_KEY" \
  -d '{"challengeId":"<challengeId>","inboxToken":"<inboxToken>"}'   # → {"code":"123456",...}
```

목 모드에서는 MOCK 패널의 "모의 수신함"에 번호가 표시됩니다.

### MOCK 패널

- **장애 주입:** 다음 요청 1회에만 적용되고, 이후 `none`으로 돌아갑니다.
  - `network`, `timeout`, `500`: 요청을 처리하지 않고 실패시킵니다.
  - `commit-then-502`: 멱등 요청(가입·계좌개설·가상 입금·이체 실행·예적금 가입/납입/해지)을 처리·커밋한 뒤 HTML 502를 반환합니다. 프론트가 같은 멱등키로 재시도해 한 번만 처리되는지 시연할 때 씁니다.
- **모의 수신함:** 최근 인증번호 5개.
- **목 DB 리셋:** 초기 데이터로 되돌리고 로그아웃합니다.
- **세션 유휴 만료시키기:** 로그인 세션을 10분 유휴 상태로 만듭니다(다음 요청에서 로그인 화면으로 이동).

## 페이지와 URL

- URL에 `.html`이 없습니다. `/inquiry/accounts/` → `public/inquiry/accounts/index.html`
- 내부 링크는 끝 슬래시를 붙입니다(`/login/`). 슬래시가 없으면 서버가 슬래시 붙은 주소로 한 번 리다이렉트합니다.
- CSS·JS는 항상 절대 경로(`/assets/...`)로 참조합니다.

## 사이트맵과 HTML 생성

메뉴 구조는 `site/sitemap.mjs` 한 곳에 있습니다. GNB, 좌측 메뉴(LNB), 현재 위치(breadcrumb), 푸터, `/sitemap/` 페이지, 준비 중 화면이 모두 여기서 만들어집니다.

| 명령 | 동작 |
|---|---|
| `npm run build` | 사이트맵으로 HTML을 생성·갱신 |
| `npm run check` | 파일을 쓰지 않고 최신 상태인지 검사. 다르면 실패 → **커밋·푸시 전에 실행** |

- `status: 'stub'` 페이지는 파일 전체가 생성됩니다. 직접 고치지 말고 사이트맵이나 `site/templates.mjs`를 고치세요.
  자동 생성 표시가 없는 파일(사람이 만든 파일)은 덮어쓰지 않고 오류를 냅니다.
- `status: 'live'` 페이지는 직접 작성합니다. 파일 안의 `<!-- layout:이름 -->` ~ `<!-- /layout:이름 -->` 구간만 생성기가 교체하므로, 그 구간 안은 수정하지 마세요.
- 준비 중 화면을 실제 화면으로 바꾸려면: 사이트맵에서 `status`를 `live`로 바꾸고, 파일 맨 위의 자동 생성 주석을 지운 뒤 본문을 작성합니다.
- 생성 결과는 커밋합니다. 배포할 때는 `public/`을 그대로 복사하면 되고 Node가 필요 없습니다.

## 구조

```
site/
  sitemap.mjs         메뉴·페이지 정의 (단일 원본)
  templates.mjs       GNB·LNB·푸터·준비 중 화면 HTML 조각
  build.mjs           생성기
public/
  index.html          메인 (직접 작성)
  login/, join/, inquiry/accounts/, ...   각 경로의 index.html
  assets/css/         style.css(공통 요소), layout.css(페이지 골격)
  assets/js/config.js       USE_MOCK, 타임아웃, 재시도 간격, 카카오맵 키
  assets/data/realestate.json  부동산 임시 시세 (정적)
  assets/js/routes.js       화면 코드가 이동하는 경로 상수
  assets/js/api.js          요청 계층: /api/v2 호출, 토큰, 오류 파싱, 재시도, 멱등키(IdempotentTx)
  assets/js/money.js        금액 십진 문자열 처리(BigInt, Number 변환 없음)
  assets/js/contact-verify.js  모의 휴대폰 확인(인증번호 요청·확인 → contactGrant)
  assets/js/recovery-proof.js  계정 복구 증명(계좌 또는 복구 코드)
  assets/js/savings.js      예금·적금 공통 표시 규칙
  assets/js/session.js      토큰 저장·절대 만료, 로그인 필요 페이지 보호, ?next= 복귀
  assets/js/layout.js       모든 페이지 공통: 로그인 상태, 세션 남은 시간(서버 idleExpiresAt)·연장·서버 로그아웃, 모바일 메뉴
  assets/js/validate.js     입력 검증 (사용자 편의용, 보안 수단 아님)
  assets/js/format.js       금액·날짜 표시
  assets/js/ui.js           오류 표시 등 화면 공통
  assets/js/pages/*.js      페이지별 스크립트
  mock/               목 서버와 개발 패널
```

## 로그인 필요 페이지

사이트맵의 `auth: true` 페이지에 토큰 없이 들어오면 `/login/?next=<현재 경로>`로 이동하고, 로그인 후 그 경로로 돌아옵니다.
`next`는 같은 오리진의 경로만 허용합니다(`//evil.com`, `https://...` 등은 홈으로 바뀜).
이것은 화면 이동일 뿐 보안 수단이 아닙니다. HTML은 누구나 받을 수 있고, 데이터는 서버의 401·404가 보호합니다.

API 계약은 백엔드 v6(`bank-backend-v6/`)을 따릅니다. 오류는 `{code, message, field?}`이며 화면은 code로 분기합니다. 401이라도 `REAUTHENTICATION_FAILED`·`LOGIN_FAILED`는 로그아웃하지 않고 `UNAUTHORIZED`만 세션 만료로 처리합니다.

## 카카오맵 (부동산 시세조회)

`config.js`의 `KAKAO_MAP_KEY`는 Kakao Developers 앱의 **JavaScript 키**입니다. 등록된 도메인에서 열 때만 지도가 뜹니다.
현재 등록된 주소는 `http://localhost:5500`뿐입니다(`127.0.0.1`이나 다른 포트로 열면 지도 대신 목록만 나옵니다).
서버에 배포하면 그 주소를 [앱] > [플랫폼 키] > [JavaScript 키] > [JavaScript SDK 도메인]에 추가해야 합니다.
