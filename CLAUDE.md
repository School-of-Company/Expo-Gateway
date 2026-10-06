# Expo Gateway — Claude Code Operating Guide

## Project Overview

`expo-gateway` is the API gateway for the Expo (startup expo project) MSA. It fetches its own
config from `expo-config-server` on boot (`GET /configs/gateway/:profile`), registers itself with
Eureka, and reverse-proxies every request to whichever backend service Eureka reports for the
request's path prefix — verifying JWTs (RS256, verify-only) and rate-limiting by IP along the way.

**Framework:** NestJS 11
**Language:** TypeScript
**Package manager:** npm
**Status:** Core gateway implemented (bootstrap, config, Eureka routing, JWT auth, rate limiting); cross-repo follow-ups pending (see below)

> **Response language:** Always respond in Korean, per this user's global instructions — this
> overrides the sibling `expo-config-server` repo's "always respond in English" note, which does
> not apply here.

---

## Validation Commands

```bash
# Required
npm test                # Unit tests (jest)
npm run test:e2e        # e2e tests (real HTTP stack, stub Eureka/upstream)

# Recommended
npx tsc -p tsconfig.build.json --noEmit   # Type check
npm run lint             # eslint

# Run
npm run start:dev

# Local monitoring (Prometheus + Grafana)
docker compose up -d      # Grafana http://127.0.0.1:3001, Prometheus http://127.0.0.1:9090
docker compose down       # never add -v (volumes keep the dashboards' history)
```

---

## Project Structure

```
expo-gateway/
├── src/
│   ├── main.ts                       # 2 lines: calls runBootstrap()
│   ├── app.module.ts                 # Wires GatewayConfigModule, EurekaClientModule (via ProxyModule),
│   │                                 # ThrottlerModule, ProxyModule; APP_GUARD x2
│   ├── bootstrap/                    # Runs BEFORE Nest exists — env reading, Config Server fetch, fail-fast
│   ├── config/                       # GATEWAY_CONFIG token + GatewayConfigService (typed getters)
│   ├── eureka/                       # Eureka options factory + single-registration wrapper module
│   ├── auth/                         # JWT (RS256) verify-only guard + public-path matching
│   ├── proxy/                        # Catch-all controller, route resolution, load balancing,
│   │                                 # request-metrics middleware, background Eureka poller
│   ├── metrics/                      # MetricsService (prom-client) + separate-port /metrics server
│   └── health/                       # GET /health only
├── monitoring/                       # Prometheus config + alert rules, Grafana provisioning + dashboard
├── docker-compose.yml                # Prometheus + Grafana (gateway itself runs on the host)
└── test/
    ├── support/gateway-test-app.ts   # e2e helper: seeds config singleton, overrides EurekaService
    └── *.e2e-spec.ts
```

---

## Gateway Domain Flow

```
Client → Gateway
  ThrottlerGuard (IP-based, 429 on exceed)
  → JwtAuthGuard (public method+path? skip : verify RS256, 401 on failure)
  → ProxyController (@All('/{*splat}'))
      → RouteResolverService: path prefix → Eureka app name (config-driven, longest-prefix-wins;
                                             no matching prefix → 404)
      → LoadBalancerService: getInstances(appName) → filter UP → round-robin
                              (no healthy instance → 503, lookup itself fails → 502)
      → http-proxy-middleware streams the request to the chosen instance

Boot: bootstrap/run.ts fetches GET /configs/gateway/:profile from expo-config-server BEFORE
NestFactory.create(); any failure (network error, or the Config Server's own 404/503) exits the
process — no retry, matching every other service in this MSA.
```

---

## Monitoring

- Metrics are served by `src/metrics/metrics.server.ts` on a **separate listener** (`METRICS_HOST`,
  default `127.0.0.1`; `METRICS_PORT`, default `9464`), never on the public port, so they bypass
  JWT, the rate limiter, and the catch-all proxy and can't leak through the public interface.
- Request metrics are recorded by `HttpMetricsMiddleware`, which runs before the guards (401/429 are
  measured too; a client that disconnects early is recorded as 499). The label set is deliberately
  small: `method`, `status`/`status_class`, `app` (routed Eureka app, or `unmatched` / `gateway`).
- `gateway_upstream_healthy_instances` is written only by `UpstreamHealthPoller` (every 10s, so it
  stays fresh with no traffic). **It is Eureka's view, not proof of reachability**: a killed
  instance (SIGKILL/OOM/host down) is never deregistered and stays `UP` until its lease expires
  (default 90s + eviction), while requests to it fail with 502. That is why there is a
  `GatewayUpstream502Rate` alert besides `GatewayNoHealthyInstances`.
- Poll load on Eureka: one lookup per routed app every 10s (16 services ≈ 1.6 req/s), separate
  from the per-request lookup measured by `gateway_eureka_lookup_duration_seconds`.
- A failing metrics server or poller only logs; it never takes the gateway down.

---

## Agent Routing

| Task | Agent |
|------|-------|
| Add new feature | `feature-agent` |
| Fix a bug | `fix-agent` |
| Write tests | `test-agent` |
| Code review | `review-agent` |
| Write PR description | `pr-agent` |
| Apply review feedback | `feedback-agent` |

---

## Feature Development Flow

1. `git status` — check current state
2. Create branch off `develop`: `git checkout -b feat/<scope> origin/develop` (or use `new-branch`)
3. Implement with `feature-agent`
4. Verify with `npm test` and `npm run test:e2e`
5. Verify with `npx tsc -p tsconfig.build.json --noEmit` and `npm run lint`
6. Review diff with `review-agent`
7. Draft PR into `develop` with `pr-agent`

## Bug Fix Flow

1. Reproduce the bug
2. `git checkout -b fix/<scope> origin/develop`
3. Apply minimal fix with `fix-agent` — check the "Known Failure Modes" list in that agent first
4. Add regression test
5. Verify with `npm test`

## Test Writing Flow

- Write jest-based tests with `test-agent`
- Unit test: mock the collaborator (`EurekaService`, `GatewayConfigService`) with a cast object,
  direct instantiation (no DI container needed for a single class)
- e2e test: use `test/support/gateway-test-app.ts`'s `createTestApp()`, which seeds the config
  singleton and overrides `EurekaService`; spin up a real stub HTTP server for anything that needs
  an actual proxy target
- Isolate side effects: always restore `process.env` and close the app in `afterAll`/`afterEach`

---

## Branching Model

- `develop` is the integration branch. All `feat/`/`fix/`/`chore/`/`refactor/`/`test/`/`docs/`
  branches fork from `origin/develop` and PR back into `develop`.
- `main` is the stable/release branch. It only moves via a separate, manual `develop` → `main`
  release PR — day-to-day feature work never targets `main` directly.

## Git Rules

- No direct commits to `main` or `develop`
- Do not commit or push without explicit request
- Always run `git status` before starting work
- Branch naming: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`
- Do not add a `Co-Authored-By: Claude` (or similar AI attribution) trailer to commits or PRs in this repo — commits are authored by the person running Claude Code, full stop

## Coding Standards

- Keep I/O-free logic as pure functions — `route-resolver.service.ts`'s prefix-matching and
  `eureka-options.factory.ts` are the reference
- External I/O (Eureka HTTP calls, the Config Server fetch) stays out of guards/controllers
- Read boot-time env vars only inside `src/bootstrap/env.ts` — never `process.env` directly
  elsewhere
- Config that can change per environment (routing table, JWT key, rate limit, public paths) comes
  from `GatewayConfigService`, not a hardcoded constant or a fresh env var
- Strict TypeScript typing — no `any`; narrow parsed results explicitly
- Comments only when the WHY is non-obvious (e.g., why `algorithms: ['RS256']` must be pinned, why
  a token is in its own file)

## Security Rules Summary

> Full rules: `.claude/rules/security.md`

- Never log a JWT, a public/private key, or the Config Server response body
- Metrics stay on their own listener (loopback by default) and never carry tokens, keys, user ids,
  or raw paths
- Always pin `algorithms: ['RS256']` on `jwt.verify` — omitting it is an alg-confusion vulnerability
- Never hardcode a JWT key, Eureka URL, or Config Server URL
- `JwtAuthGuard` deletes any client-supplied `X-User-Id` / `X-User-Role` first, then sets them from
  the verified token's `sub` / `role` — never let a client-supplied value through, and don't forward
  other claims as headers without a design decision

## Architecture Rules Summary

> Full rules: `.claude/rules/architecture.md`

- Layers: `bootstrap/` (pre-Nest) → `config/` (DI-graph config) → `eureka/`, `auth/`, `proxy/`,
  `health/` (feature modules)
- A DI token used by both a module and its service must live in its own file — the two importing
  it from each other is a circular require that makes `@Inject()` silently capture `undefined`
- `EurekaModule.forRootAsync()` must be called exactly once (`eureka-client.module.ts`) — a second
  call starts an independent registration/heartbeat loop
- Metric labels must stay low-cardinality (never a raw path or user id); only the poller writes the
  UP-instances gauge; observability failures are logged, never fatal
- Check `npm view <pkg> type` before adding a dependency — pure ESM breaks this project's CJS build

---

## Cross-Repo Follow-Ups (not this repo's job, but blocking a real deployment)

- `Expo-Config-Server`: `configs/gateway-local.yml` is added; `gateway-dev.yml` / `gateway-prod.yml`
  still need environment-specific Eureka URLs (`eureka.serviceUrl`) before those profiles can boot
- The JWT public key (the pair of the Auth service's signing key) needs to be in Vault under
  `secret/gateway` as `{"jwt": {"publicKey": "..."}}` — the Config Server deep-merges it in
- The routing table in `gateway-{profile}.yml` is the only place a service prefix lives. Eureka app
  names other than `expo-expo-server`, `expo-form-server`, `expo-application-server`,
  `expo-report-server` are inferred from the `expo-{name}-server` pattern and unconfirmed. A path
  with no matching prefix gets a 404 — there is no catch-all service
