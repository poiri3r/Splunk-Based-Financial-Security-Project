# 코드를 처음 읽는 사람을 위한 안내

이 폴더의 코드는 내부망에서 실행되는 Spring Boot API 서버입니다. DMZ 화면과 BFF 코드는 포함하지 않습니다.

## 어디부터 볼까요?

1. `src/main/java/com/club/bank/BankApplication.java`: 서버를 시작하는 코드.
2. `Health.java`: 가장 짧은 API. `/health` 요청을 받고 JSON으로 응답합니다.
3. `Api.java` 맨 아래 `BankController`: 어떤 주소로 어떤 기능을 호출하는지 확인합니다.
4. `Api.java`의 `BankService`: 회원가입·로그인·계좌 개설·조회·가상 입금·송금의 처리 과정을 읽습니다.
5. `SecurityConfig.java`: 토큰 검사와 접근 규칙을 확인합니다.
6. `Model.java`, `Repositories.java`: 데이터의 구조와 조회·저장 방법을 확인합니다.

## 파일별 역할

| 파일 | 담당 역할 |
|---|---|
| BankApplication.java | 실행 시작점 |
| Health.java | 서버 응답 확인 |
| Api.java | 요청 데이터 형식, HTTP 주소, 은행 업무 처리 |
| ApiErrors.java | code/message 공통 오류 응답과 입력 검증 오류 처리 |
| SecurityConfig.java | 비밀번호 해시 도구, 토큰 인증, 주소별 접근 규칙 |
| Model.java | 사용자·계좌·거래내역·토큰의 DB 연결 구조 |
| Repositories.java | DB 조회·저장 함수의 정의 |
| DemoData.java | demo 프로필에서 예제 사용자와 잔액 생성 |
| application.yml | 기본 포트·메모리 DB 설정 |
| application-postgres.yml | PostgreSQL 연결·Flyway 실행 설정 |
| db/migration/V1__initial_schema.sql | Flyway가 실행하는 최초 테이블 생성 SQL |
| db/migration/V2__idempotency_records.sql | 사용자별 중복 요청 기록 테이블 |
| docs/schema-commented.sql | 위 SQL을 줄별로 설명한 읽기용 사본 |
| pom.xml | 라이브러리와 Java 버전, 빌드 설정 |
| Dockerfile | 컨테이너 이미지 제작 절차 |
| .gitignore | Git에 추가하지 않을 파일 규칙 |
| README.md | 실행 및 API 사용 설명 |

## 로그인 요청을 따라 읽기

- `BankController.login()`이 JSON을 `LoginRequest`에 담고 입력을 검증합니다.
- `BankService.login()`이 `UserRepo`로 사용자를 찾고 비밀번호를 비교합니다.
- 성공하면 토큰의 해시와 만료 시각을 `AuthToken`으로 저장하고 원본 토큰을 응답합니다.
- 다음 계좌 조회 요청에서는 `TokenFilter`가 Bearer 토큰을 검사합니다.
- BFF 구성에서는 DMZ 서버가 이 원본 토큰을 보관하고 사용자별 세션과 연결해야 합니다. 이 ZIP에는 그 BFF 구현이 없습니다.

## 문법을 읽는 법

| 표기 | 의미 |
|---|---|
| `// 설명`, `/* 설명 */` | 사람이 읽는 주석. Java 실행 명령이 아닙니다. |
| `String name` | 문자열을 담는 name 변수 |
| `=` / `==` | 값 대입 / 비교 |
| `if (...)` | 조건이 맞으면 실행 |
| `!`, `&&`, `\|\|` | 부정, 그리고, 또는 |
| `{ ... }` | 클래스·메서드·조건 등의 코드 범위 |
| `return` | 결과를 반환하고 메서드 종료 |
| `new Account(...)` | 계좌 객체 생성 |
| `users.findById(id)` | users 객체의 조회 기능 호출 |
| `throw` | 예외를 발생시켜 정상 처리를 중단 |
| `try / catch` | 오류가 날 수 있는 코드 실행 / 해당 오류 처리 |
| `List<AccountView>` | AccountView 여러 개의 목록 |
| `Optional<Account>` | Account가 있을 수도, 없을 수도 있는 결과 |
| `a -> ...` | a를 받아 처리하는 짧은 함수(람다) |
| `@...` | Spring·JPA 등에 동작 규칙을 전달하는 표시(어노테이션) |

## 이번 주석 작업의 확인 범위

- Java 7개 파일은 주석과 공백을 제외한 코드 토큰이 원본과 동일한지 비교합니다.
- YAML·XML의 설정값과 Docker 실행 명령을 비교합니다.
- 실행용 Flyway SQL은 바이트 단위로 보존합니다. 주석본은 자동 실행 경로 밖에 있습니다.
- 이 비교는 설명 추가에 따른 코드 변형 여부를 확인하는 것입니다. 기존 은행 기능의 실행·동시성·보안을 검증했다는 뜻은 아닙니다.
