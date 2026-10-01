export interface RoutingConfig {
  prefixes: Record<string, string>;
}

export interface RateLimitConfig {
  ttlSeconds: number;
  limit: number;
}

export interface EurekaSharedConfig {
  serviceUrl: string | string[];
  heartbeatIntervalSeconds?: number;
  leaseDurationSeconds?: number;
  requestTimeoutMs?: number;
}

export interface GatewayConfig {
  port?: number;
  jwt: {
    publicKey: string;
  };
  eureka: EurekaSharedConfig;
  routing: RoutingConfig;
  rateLimit?: RateLimitConfig;
  /**
   * `"/path"` (any method, prefix match) or `"METHOD /path"` (that method and
   * that exact path only). See `auth/public-path.matcher.ts`.
   */
  publicPaths?: string[];
}

export interface InstanceEnv {
  hostName: string;
  ipAddr: string;
  port: number;
}
