import { isIP } from 'node:net';
import type { GatewayConfig } from './gateway-config.types';

/**
 * `"IP"` or `"IP/prefix"` with a prefix of at least /24 (IPv4) or /64 (IPv6).
 * A trusted proxy is a specific host (the Next server); a wide range would let
 * anyone inside it forge X-Forwarded-For (`0.0.0.0/0` trusts the internet).
 * IPv4-mapped IPv6 is rejected: write the IPv4 form (a mapped `::ffff:0:0/96`
 * would cover the whole IPv4 internet while looking like a narrow v6 range).
 */
export function isTrustedProxyEntry(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^([^/]+)(?:\/(\d{1,3}))?$/.exec(value);
  if (!match || match[1].includes('%')) return false;
  const family = isIP(match[1]);
  if (family === 0) return false;
  const [min, max] = family === 4 ? [24, 32] : [64, 128];
  const prefix = match[2] === undefined ? max : Number(match[2]);
  if (prefix < min || prefix > max) return false;
  return (
    family === 4 ||
    !new URL(`http://[${match[1]}]`).hostname.startsWith('[::ffff:')
  );
}

/**
 * Express `trust proxy`: loopback (Apache on the same host) plus the configured
 * proxies (the Next server, which Apache appends to X-Forwarded-For). Never a
 * hop count — `/expo/` is reachable directly through Apache, so with `2` a
 * client's forged first X-Forwarded-For value would become `req.ip`.
 */
export function trustProxy(config: GatewayConfig): string[] {
  return ['loopback', ...(config.trustedProxies ?? [])];
}
