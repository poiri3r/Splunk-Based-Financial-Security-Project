> 1차 작업의 검증 기록입니다. 최신 검증은 VALIDATION_STAGE2.md를 참고하세요.

# 검증 결과 — 2026-10-02

## 실제 수행

- 변경 전 기존 통합 테스트 6건 통과. Mockito agent attach가 제한되어 테스트 전용 subclass MockMaker 설정 후 실행했다.
- 파일 분리 직후 24개 최상위 선언의 주석·공백 제외 토큰이 원본과 동일함을 확인했다. 이후 암호화 단계에서는 의도적으로 엔티티·서비스·조회 코드를 변경했다.
- 최종 테스트 13건, 실패 0·오류 0. H2 메모리 및 H2 PostgreSQL 호환 모드로 수행했다.
- 기존 데이터가 있는 V2 스키마 → V3/V4/V5 마이그레이션, 재실행 시 추가 적용 없음, 아이디·계좌·원장 복호화 일치, 잔액·원장금액·기존 멱등 결과 보존 검증.
- Flyway가 만든 스키마에서 Hibernate validate와 API 통합 검증.
- 암호문 무작위성·변조·다른 행/필드·잘못된 키 거절, 키 누락·동일 키 사용 거절, 기존 DB의 변경된 키 거절.
- 원본 V1/V2 SQL 바이트 동일 확인.

| 테스트 | 건수 | 실패 | 오류 |
|---|---:|---:|---:|
| EncryptedStorageIntegrationTest | 2 | 0 | 0 |
| EncryptionMigrationTest | 1 | 0 | 0 |
| FieldCryptoTest | 2 | 0 | 0 |
| FrontendContractIntegrationTest | 5 | 0 | 0 |
| IdempotencyIntegrationTest | 1 | 0 | 0 |
| MigratedSchemaIntegrationTest | 2 | 0 | 0 |

## 미검증·적용 조건

실제 PostgreSQL 서버, 동시 거래/잠금 경합, 운영 데이터·백업 복원, 실제 프론트/Nginx, Windows 실행은 이번 환경에서 검증하지 않았다. PostgreSQL 배포 전 별도 테스트 DB에서 검증해야 한다. H2의 PostgreSQL 호환 모드는 PostgreSQL 서버와 동일하지 않다.

새로운 완전 빈 일회용 PostgreSQL DB에서 이전 테스트를 실행하는 예:

```powershell
mvn test '-Dtest=EncryptionMigrationTest' '-Dmigration.test.url=jdbc:postgresql://localhost:5432/bank_migration_test' '-Dmigration.test.user=banktest' '-Dmigration.test.password=<테스트전용암호>'
```

이 테스트는 V1/V2와 고정 테스트 행을 만들고 V5까지 이전하므로 기존 업무 DB에는 실행하지 않는다. 공개 테스트 키로 암호화한 DB는 폐기한다. 명령행 비밀번호 기록을 피하려면 실행 환경의 비밀 주입 방식으로 테스트 설정을 확장한다.

원본 ZIP에 있던 target 결과는 근거로 사용하지 않았다. 전달 ZIP에는 target·빌드 캐시·실행 환경 키를 넣지 않는다.
