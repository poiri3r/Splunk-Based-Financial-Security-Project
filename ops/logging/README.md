# 로컬 로그 수집

Splunk 없이 Fluent Bit 5.1.5로 감사·접근 로그를 읽어 별도 Docker 볼륨에 JSONL로 저장한다. 백엔드 소스와 테스트는 변경하지 않는다.

| 입력 | 수집 파일 | 식별 필드 |
|---|---|---|
| `backend-audit` 볼륨의 `audit*.log` | `/data/collected/backend-audit.jsonl` | `service=backend`, `logType=audit` |
| `frontend-logs` 볼륨의 `access*.jsonl` | `/data/collected/nginx-access.jsonl` | `service=frontend`, `logType=access` |

출력·읽은 위치 DB·버퍼는 `collected-logs` 볼륨의 `/data` 아래에 보관한다. 최초 시작에는 기존 입력 파일도 읽고, 이후에는 저장된 위치부터 이어 읽는다. 원본 `timestamp`, 감사 `eventId`, `requestId`와 `sourceFile`을 보존한다.

## 실행

실제 Git 저장소 루트에서 실행한다. 기존 backend와 DB가 실행 중이면:

```bash
docker compose config --quiet
docker compose build log-collector frontend
docker compose up -d --no-deps log-collector frontend
docker compose ps -a
python3 ops/logging/verify.py --check-restart
```

전체 서비스를 처음 시작할 때는 기존 `.env`를 준비하고 `docker compose up -d --build`를 실행한다. 검증 명령은 존재하지 않는 임의 계정으로 로그인 실패를 발생시킨다. `--check-restart`는 수집기만 재생성한다. 실제 계정의 실패 카운터나 금융 거래는 변경하지 않지만 IP별 요청 제한 카운터와 로그는 발생한다. 기본 URL은 `http://localhost:5500`이며 `--base-url`로 바꿀 수 있다.

수집 결과를 호스트로 복사하려면:

```bash
docker compose cp log-collector:/data/collected ./collected-log-export
```

로그에는 사용자 식별자·IP 등이 포함될 수 있다. 내보낸 원문을 채팅에 붙이거나 Git에 추가하지 않는다. `collected-log-export/`는 Git 제외 대상이다. 수집기 상태 메시지는 `docker compose logs --tail=50 log-collector`로 확인한다.

## 보안·보관 범위

- 수집기는 UID/GID 10001, 입력 볼륨 읽기 전용, 루트 파일시스템 읽기 전용으로 실행한다. Docker 소켓·호스트 포트·네트워크 연결은 사용하지 않는다.
- Nginx는 JSON 접근 로그에 시각·메서드·쿼리 없는 경로·상태·IP·처리 시간·백엔드 응답 `X-Request-ID`를 기록한다. 정적 요청 등 백엔드를 거치지 않는 요청은 이 `requestId`가 비어 있고 별도 `nginxRequestId`를 갖는다.
- 요청 본문·쿼리 문자열·쿠키·Authorization 헤더는 접근 로그에 기록하지 않는다. URL 경로 자체에는 비밀값을 넣지 않는다. IP는 현재 Nginx가 실제로 관측한 연결 주소이며 Docker NAT 뒤 원래 클라이언트 IP 보존은 별도 검증 대상이다.
- 수집 출력은 파일별 20MB 기준으로 회전하고 압축본 5개를 유지한다. 이는 무기한 원본 보관이나 전송 대기열이 아니다. 추후 Splunk를 연결해도 이미 수집한 파일이 자동 전송되는 것은 아니므로 별도 backfill 경로를 정한다.
- 출력 장애 시 디스크 버퍼를 사용한다. 출력별 버퍼 한도는 256MB이며 초과하면 오래된 청크가 폐기될 수 있다. 전체 디스크 부족·강제 종료에서 무손실이나 정확히 한 번 처리를 보장하지 않는다. 입력의 1MB 초과 행은 경고 후 건너뛴다.
- 백엔드 원본 감사 파일의 회전·보관은 기존 애플리케이션 정책을 따른다. 새 Nginx 원본 파일은 현재 자동 회전하지 않는다. 장시간·대량 공격 실습 전에 원본 회전·보관 정책을 추가한다. 수집기 출력 회전이 Nginx 원본을 정리하지 않는다.
- 백엔드 일반 실행 로그, Nginx 오류 로그, DB 로그, 방화벽·IDS 로그는 이번 수집 대상이 아니다. 기존 Docker 로그에서 확인하며 후속 입력으로 추가한다. Splunk·방화벽·IDS는 설치하지 않는다.
- `docker compose down -v`를 실행하면 DB·감사·수집 볼륨이 삭제되므로 사용하지 않는다.

Nginx 원본을 수동 회전해야 할 때는 수집기를 실행한 상태에서 파일을 이름 변경한 뒤 Nginx에 재열기를 요청한다. 이 명령은 이전 파일을 삭제하지 않는다.

```bash
docker compose exec -T frontend sh -c 'mv /var/log/bank/access.jsonl "/var/log/bank/access.$(date -u +%Y%m%dT%H%M%SZ).jsonl" && nginx -s reopen'
```

## 근거

- [Fluent Bit 5.1.5](https://fluentbit.io/announcements/v5.1.5/)
- [Tail 입력과 위치 DB](https://docs.fluentbit.io/manual/data-pipeline/inputs/tail)
- [File 출력과 회전](https://docs.fluentbit.io/manual/data-pipeline/outputs/file)
- [Nginx JSON 로그](https://nginx.org/en/docs/http/ngx_http_log_module.html)
