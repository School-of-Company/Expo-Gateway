// How long an instance that failed to accept a connection is kept out of the
// round-robin. Eureka keeps a crashed instance UP for 3.5-4 minutes (lease 90s
// + eviction 60s + response cache 30s, load-test/RESULTS.md section 2); 10s is
// short enough that a restarted instance is back almost at once, and costs one
// probing request per instance per 10s while it stays dead (which the retry in
// ProxyController sends elsewhere when it can).
export const QUARANTINE_MS = 10_000;

/**
 * Passive health check: remembers instances (`http://ip:port`) whose last
 * connection attempt failed and hides them from the load balancer until the
 * quarantine runs out. No active probing — the first request after expiry is
 * the probe.
 */
export class InstanceQuarantine {
  private readonly until = new Map<string, Map<string, number>>();

  constructor(
    private readonly quarantineMs = QUARANTINE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns true when the instance was not already quarantined (a new event). */
  add(app: string, url: string): boolean {
    const byUrl = this.until.get(app) ?? new Map<string, number>();
    this.until.set(app, byUrl);
    const fresh = !this.isActive(byUrl, url);
    byUrl.set(url, this.now() + this.quarantineMs);
    return fresh;
  }

  /** The quarantined subset of `urls` for `app`, dropping expired entries. */
  quarantined(app: string, urls: string[]): Set<string> {
    const byUrl = this.until.get(app);
    const out = new Set<string>();
    if (!byUrl) return out;
    for (const [url] of byUrl) {
      if (!this.isActive(byUrl, url)) byUrl.delete(url);
    }
    for (const url of urls) if (byUrl.has(url)) out.add(url);
    return out;
  }

  private isActive(byUrl: Map<string, number>, url: string): boolean {
    const until = byUrl.get(url);
    return until !== undefined && until > this.now();
  }
}
