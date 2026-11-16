---
paths:
  - "src/**"
  - "test/**"
---

# Overview

## Project Overview

`expo-gateway` is the API gateway for the Expo (startup expo project) MSA. It fetches its own
config from `expo-config-server` on boot (`GET /configs/gateway/:profile`), registers itself with
Eureka, and reverse-proxies every request to whichever backend service Eureka reports for the
request's path prefix — verifying JWTs (RS256, verify-only) and rate-limiting by IP along the way.

**Framework:** NestJS 11
**Language:** TypeScript
**Package manager:** npm
**Status:** Core gateway implemented (bootstrap, config, Eureka routing, JWT auth, rate limiting); cross-repo follow-ups pending (see below)

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
│   ├── cors/                         # Credentialed CORS + Origin check on writes (optional `cors` config)
│   ├── metrics/                      # MetricsService (prom-client) + separate-port /metrics server
│   └── health/                       # GET /health only
├── monitoring/                       # Prometheus config + alert rules, Grafana provisioning + dashboard
├── load-test/                        # k6 + stub backends/Eureka/Config + orchestrator (see its README)
├── docker-compose.yml                # Prometheus + Grafana (gateway itself runs on the host)
└── test/
    ├── support/gateway-test-app.ts   # e2e helper: seeds config singleton, overrides EurekaService
    └── *.e2e-spec.ts
```

## Gateway Domain Flow

```
Client → Gateway
  HttpAccessLogMiddleware (one `HttpAccess` line when the response ends)
  CorsMiddleware (only with `cors`: preflight 204/403, foreign-Origin write 403)
  ThrottlerGuard (IP-based, 429 on exceed)
  → JwtAuthGuard (public method+path? skip : verify RS256, 401 on failure)
  → ProxyController (@All('/{*splat}'))
      → blocked path (`internal`/`.`/`..` segment) → 404, never forwarded
      → RouteResolverService: path prefix → Eureka app name (config-driven, longest-prefix-wins;
                                             no matching prefix → 404)
      → LoadBalancerService: getInstances(appName) → filter UP → round-robin
                              (no healthy instance → 503, lookup itself fails → 502)
      → http-proxy-middleware streams the request to the chosen instance

Boot: bootstrap/run.ts fetches GET /configs/gateway/:profile from expo-config-server BEFORE
NestFactory.create(); any failure (network error, or the Config Server's own 404/503) exits the
process — no retry, matching every other service in this MSA.
```
