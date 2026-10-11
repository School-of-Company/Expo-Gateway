import type { RateLimitConfig } from '../bootstrap/gateway-config.types';

/**
 * Used only when the Config Server payload omits `rateLimit`. Everything
 * else (`jwt.publicKey`, `eureka.serviceUrl`, `routing.prefixes`) has no safe
 * fallback and fails boot validation if missing.
 */
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  ttlSeconds: 60,
  limit: 100,
};
