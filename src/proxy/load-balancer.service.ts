import { Injectable } from '@nestjs/common';
import {
  EurekaService,
  type EurekaInstance,
} from '@school-of-company/nestjs-eureka';
import { EurekaLookupError, NoHealthyInstanceError } from './proxy.errors';

@Injectable()
export class LoadBalancerService {
  private readonly cursors = new Map<string, number>();

  constructor(private readonly eureka: EurekaService) {}

  /**
   * Resolves one healthy instance URL for `appName` via round-robin.
   * No retry against a different instance and no caching — a fresh
   * `getInstances()` call every time, per the org's fail-fast philosophy.
   */
  async pickInstanceUrl(appName: string): Promise<string> {
    let instances: EurekaInstance[];
    try {
      instances = await this.eureka.getInstances(appName);
    } catch (err) {
      throw new EurekaLookupError(appName, err as Error);
    }

    const healthy = instances.filter(
      (instance) =>
        instance.status === 'UP' && typeof instance.port === 'number',
    );
    if (healthy.length === 0) {
      throw new NoHealthyInstanceError(appName);
    }

    const cursor = this.cursors.get(appName) ?? 0;
    const chosen = healthy[cursor % healthy.length];
    this.cursors.set(appName, cursor + 1);

    return `http://${chosen.ipAddr}:${chosen.port}`;
  }
}
