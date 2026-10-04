# 2차 검증 결과

2026-10-02. 최종 소스로 Maven package 실행 성공, 테스트 23건·실패 0·오류 0, 실행 JAR 패키징 성공.

| 테스트 | 건수 | 실패 | 오류 |
|---|---:|---:|---:|
| EncryptedStorageIntegrationTest | 2 | 0 | 0 |
| EncryptionMigrationTest | 1 | 0 | 0 |
| FieldCryptoTest | 2 | 0 | 0 |
| FrontendContractIntegrationTest | 5 | 0 | 0 |
| IdempotencyIntegrationTest | 1 | 0 | 0 |
| MigratedSchemaIntegrationTest | 2 | 0 | 0 |
| Stage2ApiIntegrationTest | 5 | 0 | 0 |
| Stage2MigratedApiIntegrationTest | 5 | 0 | 0 |

## 이번에 확인한 동작

- 기존 13건 회귀 유지. 신규 5개 시나리오를 H2 자동 스키마 및 Flyway+Hibernate validate 스키마에서 각각 실행해 총 10건 추가.
- v2 로그인·내 정보, 로그아웃 뒤 v1/v2 토큰 무효, 다른 로그인 토큰 유지.
- 고객정보 암호화 저장·HMAC·전화/이메일 표준화·미인증 표시·프로필 버전 충돌·비밀번호 재확인·타인 정보 분리·null 삭제.
- UUID 계좌 상세·타인/없는 계좌 404·잘못된 UUID 400·큰 금액 문자열·기존 API 숫자형 유지.
- 계좌 개설 재시도 후 계좌 중복 없음, 입금 뒤에도 최초 개설 결과 재반환, 입금/송금과 키 충돌 검사.
- 한국 자정 포함/제외 경계, 동일 시각 원장 순서, 다음 페이지 중복 방지, 최초 최대 ID 이후 새 거래 제외, 커서 변조/필터/계좌 재사용 거절.
- 새 송금의 양쪽 원장 금액·거래 후 잔액·공통 거래 ID 일치.
- 날짜 역전·최대 범위·극단 날짜·type·size 오류 응답.
- V1~V5 SQL/Java migration 파일이 이전 작업본과 바이트 단위 동일. 이번 변경은 V6 추가.

## 검증 한계

실제 PostgreSQL 서버·동시성·Windows 실행·프론트/Nginx 연동은 수행하지 않았다. 사용자 요청에 따라 실제 DB 통합은 마지막 단계에 진행한다. H2 PostgreSQL 호환 모드는 실제 PostgreSQL 서버 검증을 대신하지 않는다.

프로필 연락처는 아직 검증하지 않으며 계정 복구에 사용하지 않는다. 계좌 상태 변경·이체한도·단계형 이체는 아직 후속 작업이다. 이번 내역의 balanceAfter는 새로 생성된 거래만 제공하며 과거 데이터는 null이다.

전달 ZIP에는 소스·테스트·문서를 포함하고 target·실행 키·로컬 Maven 캐시는 제외했다. 실제 JAR 빌드를 검증했지만 JAR은 ZIP에 포함하지 않는다.
