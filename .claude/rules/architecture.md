# Gateway Architecture Rules

## Layer Structure

```
src/
├── bootstrap/     — Runs before Nest exists: env reading, Config Server fetch, fail-fast exit.
├── config/        — Turns the fetched config into a DI-graph value (GATEWAY_CONFIG / GatewayConfigService).
├── eureka/        — Eureka registration options + the single-registration wrapper module.
├── auth/          — JWT (RS256) verify-only guard + public-path matching. No signing, ever.
├── proxy/         — The catch-all controller, route resolution, load balancing/instance selection.
└── health/        — GET /health only. Nothing else belongs here.
```

## Dependency Direction

```
main.ts → bootstrap/run.ts → (fetch Config Server, fail-fast) → NestFactory.create(AppModule)
AppModule → GatewayConfigModule, EurekaClientModule (via ProxyModule), ThrottlerModule, ProxyModule
ProxyController → RouteResolverService, LoadBalancerService → EurekaService
JwtAuthGuard (APP_GUARD) → GatewayConfigService
```

Reverse dependencies are forbidden (e.g. `bootstrap/` importing from `config/`'s Nest layer, or a
guard/service reading `process.env` directly instead of going through `GatewayConfigService`).

## Bootstrap Sequence (read this before touching `src/bootstrap/` or `src/config/`)

`@Module({...})` decorator arguments are evaluated the moment `main.ts` imports `AppModule` —
**before** the async Config Server fetch in `runBootstrap()` completes. Any dynamic module that
needs a boot-time config value (`EurekaModule.forRootAsync`, `ThrottlerModule.forRootAsync`) must
use `useFactory`, which is only a captured function reference at decoration time and only actually
*called* once Nest instantiates that provider inside `NestFactory.create()` — by which point the
fetch has already completed and `gateway-config-holder.ts`'s module-scope singleton has the value.

Do not try to thread the fetched config through `process.env` (lossy for a multi-line PEM key) or a
custom `@nestjs/config` loader (this repo deliberately doesn't depend on `@nestjs/config` — see
`fetch-gateway-config.ts`'s module doc comment for why). Use the existing
`setGatewayConfig`/`getGatewayConfig` singleton, wired into the DI graph by
`GatewayConfigModule.forRoot()`'s `useFactory: getGatewayConfig`.

## File Responsibilities

- `bootstrap/env.ts`: reads `process.env` for boot-time values only (`CONFIG_SERVER_URL`,
  `PROFILE`/`NODE_ENV`, `INSTANCE_HOSTNAME`, `INSTANCE_IP_ADDR`, `PORT`). Throws synchronously on
  anything required and missing — no lazy failure on first request.
- `bootstrap/fetch-gateway-config.ts`: the one place that calls the Config Server. Any failure
  (network error, non-2xx) throws `ConfigServerError` — never retried.
- `bootstrap/gateway-config.validate.ts`: structural validation of the fetched payload only (it's
  trusted infrastructure input, not user input — check shape, not content).
- `bootstrap/gateway-config-holder.ts`: a plain module-scope singleton, deliberately **not** a Nest
  provider (Nest doesn't exist yet when it's populated). `config/gateway-config.module.ts` is the
  only file that should import `getGatewayConfig` from it.
- `config/gateway-config.tokens.ts`: exists **only** to hold `GATEWAY_CONFIG`, separate from both
  `gateway-config.module.ts` and `gateway-config.service.ts`. Those two importing the token from
  each other is a circular require that makes `@Inject(GATEWAY_CONFIG)` capture `undefined` on
  whichever side of the cycle loads second — this happened once already; don't reintroduce it.
- `config/gateway-config.service.ts`: the only place other code should read config from. Typed
  getters, not a raw config object passthrough.
- `config/gateway-config.defaults.ts`: fallback values used **only** when the Config Server payload
  omits `rateLimit` specifically. `jwt.publicKey`, `eureka.serviceUrl`, and `routing.prefixes` have
  no safe fallback and always fail boot validation if missing — do not add defaults for them.
- `eureka/eureka-client.module.ts`: the **only** place `EurekaModule.forRootAsync()` may be called.
  Calling it more than once starts a second, independent registration/heartbeat loop (the
  library's own behavior, not this repo's). Any module needing `EurekaService` imports
  `EurekaClientModule`, which re-exports it — see the file's own doc comment for why a plain
  (non-dynamic) wrapper module solves the "imported from multiple places, registered once" problem.
- `auth/user-id.ts`: the `X-User-Id` header name and which JWT claim (`sub`) it comes from — change
  the claim here only, in one place. `jwt-auth.guard.ts` is the only code that sets the header.
- `auth/user-role.ts`: the `X-User-Role` header name, the `role` claim it comes from, and the
  allowed value shape. Same rule: `jwt-auth.guard.ts` is the only code that sets the header.
- `auth/jwt-verify.ts`: verify-only, always pins `algorithms: ['RS256']` explicitly. Never add a
  sign function here — this gateway never issues tokens.
- `proxy/route-resolver.service.ts`: pure prefix-matching logic (longest prefix wins), reads the
  routing table from `GatewayConfigService`, never hardcodes a prefix→app-name mapping.
- `proxy/load-balancer.service.ts`: one `getInstances()` call per request, filter to `UP`, round
  robin. No retry against a different instance on failure, no caching, no extra health check beyond
  Eureka's own status — this is a deliberate fail-fast choice (see below), not an oversight.
- `proxy/proxy.controller.ts`: the single catch-all route. Any gateway-owned endpoint (currently
  just `/health`) must be listed in `GATEWAY_OWNED_PATHS` and explicitly fall through via `next()`
  — Nest's controller/module registration order is not something to depend on for this.

## Error Contract

| Situation | Status |
|---|---|
| No path prefix matches `routing.prefixes` | 404 — there is no catch-all service |
| Zero `UP` instances for the resolved Eureka app | 503 (`NoHealthyInstanceError`) |
| `EurekaService.getInstances()` itself throws | 502 (`EurekaLookupError`) |
| Instance reachable per Eureka but connection fails at actual proxy time | 502 (`on.error` hook) |
| Missing/invalid/expired/wrong-algorithm JWT on a non-public path | 401 |
| Rate limit exceeded | 429 (`@nestjs/throttler`'s own response) |
| Config Server fetch fails at boot (network error, or its own 404/503) | process exits — nothing served |

No retry, backoff, or circuit-breaker anywhere in this table. This mirrors the Config Server's own
fail-fast contract (a client either gets a usable answer or fails immediately, never a degraded
retry loop) — keep new failure modes consistent with this instead of adding resilience patterns
ad hoc.

## Abstraction Principle

- Do not introduce a shared interface/abstraction before a second real use case exists.
- Move shared utilities out only when used in three or more places.

## Async

- All I/O is `async`/`await`. Use async/await consistently instead of promise chaining.
- The Config Server call uses Node's global `fetch`. Do not add a separate HTTP client library for it.

## Dependency Hygiene

- Before adding or upgrading a runtime dependency, check `npm view <pkg> type` — a pure-ESM package
  (`"type": "module"`, no CJS build) breaks `require()` under this project's CommonJS build and
  Jest config. `http-proxy-middleware` is deliberately pinned to `3.0.7`, not the latest `4.x`, for
  exactly this reason.
