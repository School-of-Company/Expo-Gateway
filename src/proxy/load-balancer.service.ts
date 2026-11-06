import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  EurekaService,
  type EurekaInstance,
} from '@school-of-company/nestjs-eureka';
import { GatewayConfigService } from '../config/gateway-config.service';
import { MetricsService } from '../metrics/metrics.service';
import type { ConnectFailureReason } from './connect-failure';
import { healthyInstances } from './healthy-instances';
import { InstanceQuarantine } from './instance-quarantine';
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
    // Not a provider: Nest passes undefined, so the default is used. Tests
    // hand in one with a fake clock.
    @Optional() private readonly quarantine = new InstanceQuarantine(),
  ) {
    this.policy = compileUpstreamPolicy(gatewayConfig.getUpstream());
  }

  /**
   * Resolves one healthy instance URL for `appName` via round-robin. No
   * caching — a fresh `getInstances()` call every time, per the org's
   * fail-fast philosophy. Instances that recently refused or timed out a
   * connection are skipped, unless that would leave none (see `reachable`).
   */
  async pickInstanceUrl(appName: string): Promise<string> {
    const urls = await this.candidateUrls(appName);
    const cursor = this.cursors.get(appName) ?? 0;
    this.cursors.set(appName, cursor + 1);
    return urls[cursor % urls.length];
  }

  /**
   * Another instance than `failedUrl` for the one retry after a connection
   * failure, or undefined when there is none left to try.
   */
  async pickRetryUrl(
    appName: string,
    failedUrl: string,
  ): Promise<string | undefined> {
    const urls = (await this.candidateUrls(appName)).filter(
      (url) => url !== failedUrl,
    );
    if (urls.length === 0) return undefined;
    const cursor = this.cursors.get(appName) ?? 0;
    this.cursors.set(appName, cursor + 1);
    return urls[cursor % urls.length];
  }

  /** Called by the proxy when a connection to `url` could not be opened. */
  reportConnectFailure(
    appName: string,
    url: string,
    reason: ConnectFailureReason,
  ): void {
    this.metrics.recordConnectFailure(appName, reason);
    if (this.quarantine.add(appName, url)) {
      this.metrics.recordQuarantine(appName);
      this.logger.warn(
        `Excluding ${appName} instance ${url} for a while: connection ${reason}`,
      );
    }
  }

  private async candidateUrls(appName: string): Promise<string[]> {
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

    return this.reachable(
      appName,
      healthy.map((i) => `http://${i.ipAddr}:${i.port}`),
    );
  }

  /**
   * Drops quarantined instances. When every instance is quarantined all of
   * them are tried anyway (fail-open, like Envoy's panic threshold): turning a
   * single-instance blip into QUARANTINE_MS of guaranteed 503s would be worse
   * than letting each request find out, which the connect timeout keeps short.
   */
  private reachable(appName: string, urls: string[]): string[] {
    const out = this.quarantine.quarantined(appName, urls);
    this.metrics.setQuarantinedInstances(appName, out.size);
    if (out.size === 0 || out.size === urls.length) return urls;
    return urls.filter((url) => !out.has(url));
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
