import type {
  RateLimitConfig,
  RoutingConfig,
} from '../bootstrap/gateway-config.types';

/**
 * Used only when the Config Server payload omits `routing`/`rateLimit`
 * entirely — unlike `jwt.publicKey`/`eureka.serviceUrl`, which have no safe
 * fallback and always fail boot if missing (see gateway-config.validate.ts).
 *
 * Application-Server and Report-Server have no controllers implemented yet,
 * so their real path prefixes aren't known — anything not listed here falls
 * through to `default` (`expo-expo-server`), which is harmless: it's just
 * where most as-yet-unbuilt domains are planned to land.
 */
export const DEFAULT_ROUTING_TABLE: RoutingConfig = {
  default: 'expo-expo-server',
  prefixes: {
    '/v1/forms': 'expo-form-server',
    '/v1/surveys': 'expo-form-server',
  },
};

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  ttlSeconds: 60,
  limit: 100,
};
