export interface BootEnv {
  configServerUrl: string;
  profile: string;
  /** Config Server Basic 인증 비밀번호. 사용자 이름은 서비스 식별자 `gateway` 다. */
  configServerPassword?: string;
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
  const configServerPassword = process.env.CONFIG_SERVER_PASSWORD || undefined;
  return { configServerUrl, profile, configServerPassword };
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

export interface LogEnv {
  level: string;
  /** Set only for the `local` profile: stdout is also mirrored to a file there. */
  logDir?: string;
}

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'];

/**
 * Never throws: the logger is installed before readBootEnv() so that its own
 * failures are logged as JSON too.
 */
export function readLogEnv(defaultLogDir: string): LogEnv {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  const level = LOG_LEVELS.includes(raw) ? raw : 'info';
  const profile = process.env.PROFILE ?? process.env.NODE_ENV;
  if (profile !== 'local') {
    return { level };
  }
  return { level, logDir: process.env.EXPO_LOG_DIR || defaultLogDir };
}
