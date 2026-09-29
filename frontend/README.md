# Frontend

은행 웹 화면(회원가입, 로그인, 내 계좌, 송금, 거래내역)입니다. 프레임워크 없이 순수 HTML / CSS / JavaScript(ES Modules)로 작성했습니다.

## 실행

Node.js LTS가 필요합니다.

```bash
cd frontend
npm install
npm run dev
```

브라우저에서 **`http://localhost:5500`** 으로 엽니다. `127.0.0.1`로 열면 저장 공간(sessionStorage)이 따로 잡히니 섞어 쓰지 마세요.

- `public/`만 웹에 노출됩니다.
- 로컬에 없는 경로(`/api/...`, `/health`)는 `localhost:8080`의 백엔드로 전달됩니다.
- ES Module은 `file://`에서 동작하지 않으므로 HTML 파일을 더블클릭해서 열면 안 됩니다.

## 목(mock) 모드와 실제 서버

`public/js/config.js`의 `USE_MOCK` 값으로 전환합니다. 다른 코드는 바꿀 필요가 없습니다.

| `USE_MOCK` | 동작 |
|---|---|
| `true` (현재) | 백엔드 없이 `public/mock/mock.js`가 응답합니다. 화면 오른쪽 아래에 MOCK 패널이 나타납니다. |
| `false` | 같은 PC의 8080에서 실행 중인 백엔드로 요청합니다. `http://localhost:5500/health` → `{"status":"ok"}`로 연결을 확인합니다. |

목 모드의 초기 데이터는 백엔드 demo 프로필과 같습니다.

| 아이디 | 비밀번호 | 계좌 | 초기 잔액 |
|---|---|---|---|
| alice | DemoPass123! | 10010001 | 100,000.00 |
| bob | DemoPass456! | 10010002 | 50,000.00 |

### MOCK 패널

- **장애 주입:** 다음 요청 1회에만 적용되고, 이후 `none`으로 돌아갑니다.
  - `network`, `timeout`, `500`: 요청을 처리하지 않고 실패시킵니다.
  - `commit-then-502`: 입금·송금을 처리하고 커밋한 뒤, 프록시 오류처럼 HTML 502를 반환합니다. 프론트가 같은 멱등키로 재시도해 잔액이 한 번만 바뀌는지 시연할 때 씁니다.
- **목 DB 리셋:** 초기 데이터로 되돌리고 로그아웃합니다.

## 구조

```
public/
  *.html              페이지 (멀티 페이지)
  css/style.css
  js/config.js        USE_MOCK, 타임아웃, 재시도 간격
  js/api.js           요청 계층: 토큰, 오류 파싱, 재시도, 멱등키
  js/session.js       토큰 저장·만료·페이지 보호
  js/validate.js      입력 검증 (사용자 편의용, 보안 수단 아님)
  js/format.js        금액·날짜 표시
  js/ui.js            오류 표시 등 화면 공통
  js/pages/*.js       페이지별 스크립트
  mock/               목 서버와 개발 패널
```

API 계약은 `backend/docs/bank-api-specv2.docx`(backend 브랜치)를 따릅니다.
