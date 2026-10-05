# Bank backend v5 — 최종 기능 누적본

1~5차 구현에 예적금 모의 가입·수동 납입·해지를 추가했습니다. 자동이체는 포함하지 않습니다. 실제 프론트 화면과 실제 DB 인프라 통합은 별도입니다.

- [프론트 최종 전달서](docs/FRONTEND_HANDOFF_FINAL.md)
- [예적금 API·요청/응답·계산 정책](docs/STAGE6_SAVINGS_API.md)
- [최종 검증 결과](docs/VALIDATION_STAGE6.md)
- [확정 범위](docs/PROJECT_SCOPE.md)
- [가입·연락처·복구](docs/STAGE5_API.md)
- [계좌 관리·PIN·한도](docs/STAGE4_API.md)
- [이체](docs/STAGE3_API.md)
- [사용자·계좌 조회](docs/STAGE2_API.md)
- [암호화 키·실행·이전 절차](docs/IMPLEMENTATION_STAGE1.md)

Java 17 / Maven 3.9 이상. `mvn test`, `mvn package`. 런타임에는 서로 다른 BANK_ENCRYPTION_KEY/BANK_LOOKUP_KEY가 필요하며 pom의 공개 키는 테스트 전용입니다. 기본 H2 메모리 DB는 종료 시 데이터가 사라집니다.

연락처 없이도 v2 가입과 복구 코드를 사용할 수 있습니다. 모의 발송은 demo-verification 프로필과 32자 이상 bank.demo-inbox-key 설정이 필요합니다. 실제 문자/메일·실명 인증·외부 은행 연동은 없습니다. 예적금 금리·세금은 프로젝트의 모의 정책입니다.

V1~V10은 변경하지 않고 V11을 추가했습니다. 실제 DB 통합은 마지막에 진행하며 현재 테스트는 H2와 H2 PostgreSQL 호환 모드/Flyway입니다. 구 기본 가입 API는 호환용이며 신규 약관을 강제하지 않습니다. 신규 프론트는 v2 가입을 사용합니다.

이전 단계 문서는 당시의 구현 기록입니다. 최종 범위와 프론트 계약은 위 최종 전달서를 우선합니다.
