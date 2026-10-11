import type { MetricsBind } from './env';
import type { MetricsService } from '../metrics/metrics.service';

interface MetricsRuntime {
  readonly service: MetricsService;
  readonly bind?: MetricsBind;
}

let current: MetricsRuntime | undefined;

export function setMetricsRuntime(runtime: MetricsRuntime | undefined): void {
  current = runtime;
}

export function getMetricsRuntime(): MetricsRuntime | undefined {
  return current;
}
