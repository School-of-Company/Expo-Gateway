import { Injectable, Logger } from '@nestjs/common';
import {
  EurekaService,
  type EurekaInstance,
} from '@school-of-company/nestjs-eureka';
import { GatewayConfigService } from '../config/gateway-config.service';
import { MetricsService } from '../metrics/metrics.service';
import { healthyInstances } from './healthy-instances';
import { EurekaLookupError, NoHealthyInstanceError } from './proxy.errors';
import { compileUpstreamPolicy, type UpstreamPolicy } from './upstream-policy';

const MAX_LOGGED_REJECTIONS = 1000;

@Injectable()
export class LoadBalancerService {
  private readonly logger = new Logger(LoadBalancerService.name);
  private readonly cursors = new Map<string, number>();
  private readonly policy: UpstreamPolicy;
  // Warn once per rejected address, not once per request.
  private readonly loggedRejections = new Set<string>();

  constructor(
    private readonly eureka: EurekaService,
    private readonly metrics: MetricsService,
    gatewayConfig: GatewayConfigService,
  ) {
    this.policy = compileUpstreamPolicy(gatewayConfig.getUpstream());
  }

  /**
   * Resolves one healthy instance URL for `appName` via round-robin.
   * No retry against a different instance and no caching — a fresh
   * `getInstances()` call every time, per the org's fail-fast philosophy.
   */
  async pickInstanceUrl(appName: string): Promise<string> {
    const startedAt = process.hrtime.bigint();
    let instances: EurekaInstance[];
    try {
      instances = await this.eureka.getInstances(appName);
    } catch (err) {
      this.recordLookup(appName, startedAt, false);
      throw new EurekaLookupError(appName, err as Error);
    }
    this.recordLookup(appName, startedAt, true);

    const healthy = this.allowedInstances(appName, healthyInstances(instances));
    if (healthy.length === 0) {
      throw new NoHealthyInstanceError(appName);
    }

    const cursor = this.cursors.get(appName) ?? 0;
    const chosen = healthy[cursor % healthy.length];
    this.cursors.set(appName, cursor + 1);

    return `http://${chosen.ipAddr}:${chosen.port}`;
  }

  /**
   * Eureka is trusted to say who is UP, not where traffic may go: an address
   * outside the upstream policy is skipped rather than proxied to.
   */
  private allowedInstances(
    appName: string,
    instances: EurekaInstance[],
  ): EurekaInstance[] {
    const allowed = instances.filter((i) =>
      this.policy.isAllowed(i.ipAddr, i.port),
    );
    const rejected = instances.length - allowed.length;
    if (rejected > 0) {
      this.metrics.recordRejectedInstances(appName, rejected);
      for (const i of instances) {
        if (this.policy.isAllowed(i.ipAddr, i.port)) continue;
        const key = `${appName}|${String(i.ipAddr)}:${String(i.port)}`;
        if (this.loggedRejections.has(key)) continue;
        if (this.loggedRejections.size >= MAX_LOGGED_REJECTIONS) {
          this.loggedRejections.clear();
        }
        this.loggedRejections.add(key);
        this.logger.warn(
          `Skipping ${appName} instance outside the upstream policy: ${String(i.ipAddr)}:${String(i.port)}`,
        );
      }
    }
    return allowed;
  }

  private recordLookup(appName: string, startedAt: bigint, ok: boolean): void {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    this.metrics.recordEurekaLookup(appName, seconds, ok);
  }
}
