---
paths:
  - "src/metrics/**"
  - "src/proxy/http-metrics.middleware.ts"
  - "src/proxy/healthy-instances.ts"
  - "monitoring/**"
  - "docker-compose.yml"
---

# Monitoring

- `METRICS_ENABLED=false` disables the metrics listener and Eureka scrape metadata (default `true`).
  Bootstrap starts the listener before creating Nest, and only passes a successful bind to Eureka.
  Registration includes string `prometheus.scrape=true`, `prometheus.port`, and `prometheus.path=/metrics`
  when the bind matches `INSTANCE_IP_ADDR` or is a compatible wildcard (`0.0.0.0` for IPv4, `::` for dual stack).
  Mismatched binds and ephemeral port `0` omit metadata. Dev uses port `18206`; prod uses `18106`.
  Prometheus must reach the registered IP from its network namespace; verify targets after deployment.

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
