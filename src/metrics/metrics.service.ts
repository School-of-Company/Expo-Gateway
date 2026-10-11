import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

const STANDARD_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

// Dense where this gateway's latencies actually sit. Buckets of 25 -> 50 -> 100ms
// made histogram_quantile snap p95/p99 to ~48ms for anything in that range (seen
// in a real load test), and the sub-millisecond ones resolve the gateway's own
// overhead.
const LATENCY_BUCKETS = [
  0.0005, 0.001, 0.0025, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04,
  0.05, 0.06, 0.075, 0.1, 0.15, 0.25, 0.5, 1, 2.5, 5, 10,
];

export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

/**
 * Label values must stay low-cardinality: never put a raw path, a user id, or
 * any other unbounded value in a label. `app` is the routed Eureka app name
 * (or `unmatched` / `gateway`), `method` is bounded to the standard verbs.
 */
@Injectable()
export class MetricsService {
  // Own registry per instance (not prom-client's global one) so tests can
  // create many services without "metric already registered" errors.
  readonly registry = new Registry();

  private readonly requests = new Counter({
    name: 'gateway_http_requests_total',
    help: 'HTTP requests handled by the gateway',
    labelNames: ['method', 'status', 'app'],
    registers: [this.registry],
  });

  private readonly requestDuration = new Histogram({
    name: 'gateway_http_request_duration_seconds',
    help: 'Total time the gateway took to answer a request, upstream included',
    labelNames: ['app', 'status_class'],
    buckets: LATENCY_BUCKETS,
    registers: [this.registry],
  });

  private readonly upstreamDuration = new Histogram({
    name: 'gateway_upstream_duration_seconds',
    help: 'Time from handing the request to the proxy until the upstream response headers arrive',
    labelNames: ['app'],
    buckets: LATENCY_BUCKETS,
    registers: [this.registry],
  });

  private readonly eurekaLookupDuration = new Histogram({
    name: 'gateway_eureka_lookup_duration_seconds',
    help: 'Per-request Eureka instance lookup time',
    labelNames: ['app'],
    buckets: LATENCY_BUCKETS,
    registers: [this.registry],
  });

  private readonly eurekaLookupFailures = new Counter({
    name: 'gateway_eureka_lookup_failures_total',
    help: 'Per-request Eureka instance lookups that failed',
    labelNames: ['app'],
    registers: [this.registry],
  });

  private readonly healthyInstances = new Gauge({
    name: 'gateway_upstream_healthy_instances',
    help: 'Instances Eureka reports as UP per app (a Eureka status, not proof of reachability)',
    labelNames: ['app'],
    registers: [this.registry],
  });

  private readonly pollFailures = new Counter({
    name: 'gateway_upstream_poll_failures_total',
    help: 'Background Eureka polls that failed',
    labelNames: ['app'],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  recordRequest(
    method: string,
    status: number,
    app: string,
    durationSeconds: number,
  ): void {
    const normalizedMethod = STANDARD_METHODS.has(method) ? method : 'OTHER';
    this.requests.inc({
      method: normalizedMethod,
      status: String(status),
      app,
    });
    this.requestDuration.observe(
      { app, status_class: statusClass(status) },
      durationSeconds,
    );
  }

  observeUpstream(app: string, durationSeconds: number): void {
    this.upstreamDuration.observe({ app }, durationSeconds);
  }

  recordEurekaLookup(app: string, durationSeconds: number, ok: boolean): void {
    this.eurekaLookupDuration.observe({ app }, durationSeconds);
    if (!ok) {
      this.eurekaLookupFailures.inc({ app });
    }
  }

  setHealthyInstances(app: string, count: number): void {
    this.healthyInstances.set({ app }, count);
  }

  clearHealthyInstances(app: string): void {
    this.healthyInstances.remove({ app });
  }

  recordPollFailure(app: string): void {
    this.pollFailures.inc({ app });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
