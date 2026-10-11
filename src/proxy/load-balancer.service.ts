import { Injectable } from '@nestjs/common';
import {
  EurekaService,
  type EurekaInstance,
} from '@school-of-company/nestjs-eureka';
import { MetricsService } from '../metrics/metrics.service';
import { healthyInstances } from './healthy-instances';
import { EurekaLookupError, NoHealthyInstanceError } from './proxy.errors';

@Injectable()
export class LoadBalancerService {
  private readonly cursors = new Map<string, number>();

  constructor(
    private readonly eureka: EurekaService,
    private readonly metrics: MetricsService,
  ) {}

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

    const healthy = healthyInstances(instances);
    if (healthy.length === 0) {
      throw new NoHealthyInstanceError(appName);
    }

    const cursor = this.cursors.get(appName) ?? 0;
    const chosen = healthy[cursor % healthy.length];
    this.cursors.set(appName, cursor + 1);

    return `http://${chosen.ipAddr}:${chosen.port}`;
  }

  private recordLookup(appName: string, startedAt: bigint, ok: boolean): void {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    this.metrics.recordEurekaLookup(appName, seconds, ok);
  }
}
