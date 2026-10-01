# Gateway 부하 테스트

Gateway를 실제로 띄우고 부하를 주어 **Gateway가 더하는 지연**과 **백엔드 장애 시 감지 공백**을 재는 환경입니다. Prometheus·Grafana(`monitoring/`)가 같이 떠서 대시보드로도 볼 수 있습니다.

## 무엇을 재는가

| 시나리오 | 의미 |
|---|---|
| `direct` | k6 → 백엔드 직접. 베이스라인 |
| `via` | k6 → Gateway(JWT 검증) → 백엔드 |
| `public` | k6 → Gateway(공개 경로, JWT 검증 없음) → 같은 백엔드 |
| `sigterm` | 부하 중 백엔드 **프로세스**에 SIGTERM. `nestjs-eureka`가 등록을 해제 |
| `sigkill` | 부하 중 백엔드 **프로세스**에 SIGKILL (크래시/OOM). 호스트는 살아 있어 포트는 즉시 거부되고, 등록 해제 없이 Eureka lease 만료를 기다림 |
| `hostdown` | 부하 중 백엔드 **컨테이너 전체**를 kill (서버 다운). IP가 사라져 연결이 거부가 아니라 매달리고, 등록 해제도 없음 |

- **Gateway 오버헤드** = `via` − `direct`, **JWT 검증 비용** = `via` − `public` (같은 경로·같은 백엔드라서 차이가 인증뿐)
- 백분위 값끼리 빼는 것은 근사입니다. 같은 조건에서 반복 측정한 중앙값으로 비교합니다.
- Gateway 자체 메트릭(`gateway_http_request_duration_seconds`, `gateway_upstream_duration_seconds`, `gateway_eureka_lookup_duration_seconds`)도 같이 질의해서 리포트에 넣습니다.

## 측정 프로토콜

1. **보정(calibration)**: Gateway 경유로 처리량을 단계적으로 올려 p95 < 100ms, 누락 요청 0, 전부 200인 최대 RPS를 찾고, 본 측정은 그 **약 50%** 의 일정 도착률로 합니다. 포화 상태가 아니라 지연 비교가 목적입니다.
2. 시나리오마다 **워밍업(기본 15초) 후 60초 × 3회** 측정해 중앙값을 보고합니다.
3. 순서 편향을 보려고 **실행 순서를 바꿔 한 번 더** 합니다 (`direct→via→public`, `public→via→direct`). 두 번의 오버헤드가 10% 넘게 다르면 리포트가 노이즈로 표시합니다.
4. 장애 시나리오는 각 3회. 백엔드 `svc-a`만 죽이고 `svc-b/c`는 그대로 둡니다. 시작 전에 모든 백엔드가 UP이고 Gateway가 scrape되는지 확인합니다.
5. 장애 시작 시점에 **이미 firing 중인 알림은 결과에서 제외**합니다. `GatewayHigh5xxRate`처럼 5분 윈도우를 쓰는 알림은 앞 시나리오의 5xx가 다음 시나리오까지 이어져서, 제외하지 않으면 "kill 2초 후 firing" 같은 무의미한 값이 나옵니다.

## 환경

`load-test/docker-compose.yml`이 전부 정의합니다 (프로젝트명 `bench-gw`, 컨테이너는 모두 `bench-gw-*`). 포트를 publish하는 것은 Prometheus(`127.0.0.1:9090`)와 Grafana(`127.0.0.1:3001`)뿐이고 둘 다 loopback입니다. Prometheus·Grafana 데이터는 `tmpfs`라 볼륨이 남지 않습니다.

| | 로컬 (`--target local`) | 스테이징 (`--target ssh`) |
|---|---|---|
| Eureka | `stub-eureka.mjs` (arm64 이미지가 없어서 직접 구현, 실제 기본값 에뮬레이션) | 실제 Eureka 서버 이미지 (`real-eureka` 프로파일) |
| CPU 격리 | 없음 | `cpuset`: k6=코어 3, Gateway=코어 1, 나머지=코어 0,2 |
| 용도 | 하네스 개발·검증 (`--fast` 권장) | **보고용 수치** |

CPU 배치: 하드웨어 인터럽트와 sshd는 보통 코어 0에 몰려서 Gateway를 코어 0에 두지 않았습니다. 그래도 지연 편차가 크면 `docker-compose.staging.yml`의 배치를 바꿔 다시 재고, 바꾼 사실을 결과에 적어 주세요.

### 로컬

```bash
node load-test/run.mjs run --target local --fast --reps 1 --duration 20 --warmup 5   # 하네스 점검
node load-test/run.mjs down --target local
```

`--fast`는 Eureka의 lease/eviction/캐시를 줄이는 개발용 프리셋입니다. **`--fast` 결과는 보고용이 아닙니다.**

### 스테이징 서버

SSH 키 인증이 되어 있어야 합니다 (`BENCH_SSH_HOST`, `BENCH_SSH_PORT`, `BENCH_REMOTE_DIR`로 바꿀 수 있고, 기본값은 `ubuntu@ssh.gsmsv.site`, `21105`, `~/bench/gateway`).

```bash
node load-test/run.mjs run --target ssh      # 소스 전송 → 빌드 → 기동 → 측정 → 리포트
node load-test/run.mjs down --target ssh     # 정리
```

서버 사용 규칙:

- 컨테이너·compose 프로젝트는 `bench-gw-` 접두사, 작업 디렉터리는 `~/bench/gateway`만 사용합니다. 서버에 Node·k6를 설치하지 않고 전부 컨테이너로 실행합니다.
- 정리는 `down`만 씁니다. **`docker volume prune`, `docker system prune` 등 서버 전체 대상 prune 금지.** `down -v`도 쓰지 않습니다 (볼륨이 없습니다).
- 외부로 publish하는 포트는 `127.0.0.1` 바인딩뿐입니다. Grafana는 SSH 터널로 봅니다: `ssh -N -L 13001:127.0.0.1:3001 -p 21105 ubuntu@ssh.gsmsv.site` → `http://127.0.0.1:13001`.
- 실행이 끝나도 스택은 남겨 둡니다. Prometheus·Grafana 데이터가 `tmpfs`라서 **`down` 전에 대시보드를 캡처**하세요.

## 결과를 읽는 법

- **알림까지 걸린 시간은 성과 수치가 아닙니다.** 폴 간격(10초) + scrape(5초) + 알림 `for`(30초) 같은 설정값이 정하므로, 알림이 "설계대로" 뜨는지만 확인하는 용도입니다.
- **SIGTERM이 "즉시" 감지되지 않아도 이상한 결과가 아닙니다.** `nestjs-eureka`는 종료 시 바로 등록을 해제하지만, 실제 Eureka 서버는 조회 응답을 약 30초 캐시(`responseCacheUpdateIntervalMs`)하므로 Gateway가 UP 0을 보기까지 최대 그만큼 걸립니다. 이 캐시 주기와 lease·eviction 주기·self-preservation 여부를 결과와 함께 기록하세요.
- **SIGKILL이 핵심입니다.** 등록이 해제되지 않아 Eureka는 lease 만료(기본 90초, eviction 주기 60초)까지 죽은 인스턴스를 `UP`으로 둡니다. 그동안 Gateway는 죽은 인스턴스로 요청을 보내 502를 내지만 `gateway_upstream_healthy_instances`는 그대로라서 `GatewayNoHealthyInstances`는 울리지 않고, `GatewayUpstream502Rate`만 울립니다. 리포트의 "502s flowing while UP was still ≥ 1"이 그 공백입니다.
- 소규모 Eureka는 **self-preservation** 때문에 eviction을 아예 안 할 수 있습니다. 리포트에 "UP never reached 0"이 나오면 그 경우입니다 (스테이징 compose는 기본으로 끕니다: `EUREKA_SELF_PRESERVATION=false`).

## 측정하면서 배운 것 (하네스를 고친 이력)

처음 측정에서 SIGKILL 결과가 비정상이었고(`GatewayEurekaPollFailing`이 죽이지 않은 `svc-b/c`에서도 울리고, Gateway 자신의 Eureka heartbeat도 실패), 원인을 추적해서 하네스를 고쳤습니다. 보고용 수치는 고친 뒤의 것만 씁니다.

- **원인**: 스텁 백엔드가 `ipAddr`에 컨테이너 **호스트네임**을 등록했고, Gateway는 요청마다 그 이름을 DNS로 풀었습니다. 컨테이너가 사라지면 Docker DNS가 그 이름을 풀지 못해 `getaddrinfo`가 ~2.2초 걸리며 실패했고, 초당 200건의 느린 조회가 libuv 스레드풀(4개)을 점유해서 `eureka` 이름 조회까지 줄을 섰습니다 (같은 컨테이너에서 재현: 죽은 이름 200건이 밀린 동안 정상 이름 조회가 22.9초). 그래서 Eureka 요청의 5초 타임아웃이 터졌습니다.
- **판단**: Gateway 결함이 아니라 하네스 인공물입니다. 실제 서비스는 `ipAddr`에 IP를 등록하고 Gateway도 `ipAddr`로 연결하므로 DNS를 타지 않습니다.
- **수정**: 백엔드가 자기 컨테이너 IP를 등록하고, SIGTERM/SIGKILL은 컨테이너가 아니라 **컨테이너 안의 node 프로세스**에만 보냅니다(PID 1은 `sleep`). 호스트가 살아 있는 크래시를 그대로 재현합니다. 호스트 소실은 별도 시나리오(`hostdown`)로 분리했습니다.
- **교훈**: 장애 주입 방식이 "무엇이 죽는가"(프로세스 vs 호스트)를 정하고, 그에 따라 증상이 완전히 달라집니다. 시나리오 이름과 모델을 결과에 같이 적으세요.

## 결과에서 짚어 둘 점

- **호스트 소실(`hostdown`)이 가장 나쁩니다.** 프록시에 업스트림 연결/응답 타임아웃이 없어서 죽은 IP로 간 요청이 클라이언트 타임아웃(k6 60초)까지 매달리고, 그동안 클라이언트 동시성이 고갈됩니다. Gateway 자체 메트릭에서는 클라이언트가 포기한 요청이 `499`로, 소요 시간 평균 60초로 보입니다. 후속 개선(프록시 타임아웃, 수동 헬스체크)의 근거입니다.
- 폴러 부하: 라우팅된 앱마다 10초에 한 번 Eureka를 조회합니다 (서비스 16개 기준 ≈ 1.6 req/s).

## 한계

- 단일 서버에서 코어를 나눠 경합을 통제하지만, 같은 호스트의 다른 컨테이너 영향을 완전히 없애지는 못합니다.
- 백엔드는 합성 지연(기본 20ms + 최대 10ms 지터)을 가진 스텁이고 응답이 작습니다. 실제 서비스의 응답 크기·DB 지연은 반영되지 않습니다.
- 로컬 모드의 Eureka는 스텁입니다 (lease·eviction·응답 캐시는 실제 기본값을 에뮬레이션).
- 요청마다 Eureka를 조회하는 현재 구조(`nestjs-eureka`에 캐시 없음)의 비용이 오버헤드에 포함됩니다. `gateway_eureka_lookup_duration_seconds`로 따로 볼 수 있고, 후속 개선(조회 캐시)의 근거가 됩니다.

## 파일

| 파일 | 역할 |
|---|---|
| `run.mjs` | 오케스트레이터: 기동, 보정, 시나리오, 장애 주입, 리포트 |
| `k6/scenario.js` | 부하 형태 (장애 주입은 k6 밖에서 시간 오프셋으로) |
| `stub-backend/` | `nestjs-eureka`를 쓰는 최소 NestJS 백엔드 (직접 짠 등록 코드가 아님) |
| `stub-config-server.mjs` | Gateway가 부팅 때 호출하는 `GET /configs/gateway/:profile` 대역 |
| `stub-eureka.mjs` | 로컬 모드 전용 Eureka 대역 |
| `docker-compose.yml`, `docker-compose.staging.yml` | 환경 정의, 스테이징 CPU 격리 |
| `Dockerfile` | Gateway와 스텁을 한 이미지로 빌드 |
