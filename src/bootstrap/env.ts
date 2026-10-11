export interface BootEnv {
  configServerUrl: string;
  profile: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function readBootEnv(): BootEnv {
  const configServerUrl = requireEnv('CONFIG_SERVER_URL');
  const profile = process.env.PROFILE ?? process.env.NODE_ENV;
  if (!profile) {
    throw new Error('Missing required env var: PROFILE (or NODE_ENV)');
  }
  return { configServerUrl, profile };
}

export function readInstanceEnv() {
  return {
    hostName: requireEnv('INSTANCE_HOSTNAME'),
    ipAddr: requireEnv('INSTANCE_IP_ADDR'),
    port: Number(process.env.PORT) || 3000,
  };
}

export interface MetricsBind {
  host: string;
  port: number;
}

export function readMetricsEnabled(): boolean {
  const value = process.env.METRICS_ENABLED ?? 'true';
  if (value !== 'true' && value !== 'false') {
    throw new Error('Invalid METRICS_ENABLED: must be true or false');
  }
  return value === 'true';
}

/**
 * The metrics listener is separate from the public one. It defaults to
 * loopback so a gateway started directly on a VM doesn't expose it on an
 * external interface; set METRICS_HOST to a private interface IP (or 0.0.0.0
 * behind a firewall / inside a private container network) when a scraper
 * can't reach loopback.
 */
export function readMetricsBind(): MetricsBind {
  const host = process.env.METRICS_HOST ?? '127.0.0.1';
  if (host.trim() === '') {
    throw new Error('Invalid METRICS_HOST: must not be empty');
  }
  const rawPort = process.env.METRICS_PORT ?? '9464';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port > 65535) {
    throw new Error(`Invalid METRICS_PORT: ${rawPort}`);
  }
  return { host, port };
}
