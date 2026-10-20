import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';

/** Sent by the Expo-Client BFF only; stripped before forwarding. */
export const BFF_TOKEN_HEADER = 'x-bff-token';

const sha256 = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

/** Constant time even when the lengths differ (both sides are hashed first). */
export function matchesBffToken(
  header: string | string[] | undefined,
  expected: string,
): boolean {
  return (
    typeof header === 'string' &&
    timingSafeEqual(sha256(header), sha256(expected))
  );
}

/**
 * The IP every rate limit counts against: `req.ip`, unless the request carries
 * the BFF token. The BFF runs on Vercel without a fixed egress IP, so it cannot
 * be in `trustedProxies` and `req.ip` is the BFF itself. With a valid token the
 * entry just left of it in X-Forwarded-For is the user IP the BFF reported.
 * `req.ips.length` is how many rightmost entries `trust proxy` (loopback Apache,
 * which appends the BFF's address) already consumed to reach `req.ip`.
 * Anything that is not a plain IP falls back to `req.ip`; IPv4-mapped IPv6 does
 * too, since the throttler's /64 grouping would put all of IPv4 in one bucket.
 */
export function rateLimitClientIp(
  req: Request,
  bffToken: string | undefined,
): string | undefined {
  if (!bffToken || !matchesBffToken(req.headers[BFF_TOKEN_HEADER], bffToken)) {
    return req.ip;
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded !== 'string') return req.ip;
  const candidate = forwarded
    .split(',')
    .map((entry) => entry.trim())
    .reverse()[req.ips.length];
  if (!candidate || candidate.includes('%')) return req.ip;
  const family = isIP(candidate);
  if (family === 4) return candidate;
  return family === 6 &&
    !new URL(`http://[${candidate}]`).hostname.startsWith('[::ffff:')
    ? candidate
    : req.ip;
}
