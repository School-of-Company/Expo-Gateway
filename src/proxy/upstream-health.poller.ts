import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { EurekaService } from '@school-of-company/nestjs-eureka';
import { GatewayConfigService } from '../config/gateway-config.service';
import { MetricsService } from '../metrics/metrics.service';
import { healthyInstances } from './healthy-instances';

export const UPSTREAM_POLL_INTERVAL_MS = 10_000;

/**
 * Keeps `gateway_upstream_healthy_instances` fresh even when an app gets no
 * traffic, so an outage during a quiet period still shows up (and recovery is
 * reflected). It is the only writer of that gauge.
 *
 * It calls Eureka directly and deliberately does not touch the
 * `gateway_eureka_lookup_*` metrics, which describe the per-request lookup
 * cost. A failing poll only logs: observability must never take the gateway
 * down. Load on Eureka: one lookup per routed app every 10s (16 services ≈
 * 1.6 req/s).
 */
@Injectable()
export class UpstreamHealthPoller
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(UpstreamHealthPoller.name);
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly eureka: EurekaService,
    private readonly gatewayConfig: GatewayConfigService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    void this.pollOnce();
    this.timer = setInterval(
      () => void this.pollOnce(),
      UPSTREAM_POLL_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async pollOnce(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const apps = new Set(
        Object.values(this.gatewayConfig.getRouting().prefixes),
      );
      await Promise.all([...apps].map((app) => this.pollApp(app)));
    } finally {
      this.polling = false;
    }
  }

  private async pollApp(app: string): Promise<void> {
    try {
      const instances = await this.eureka.getInstances(app);
      this.metrics.setHealthyInstances(app, healthyInstances(instances).length);
    } catch (err) {
      // No value is better than a stale one: drop the series so it can't keep
      // reporting an old count while Eureka is unreachable.
      this.metrics.clearHealthyInstances(app);
      this.metrics.recordPollFailure(app);
      this.logger.warn(
        `Eureka poll failed for ${app}: ${(err as Error).message}`,
      );
    }
  }
}
