export interface RoutingConfig {
  prefixes: Record<string, string>;
}

export interface RateLimitConfig {
  ttlSeconds: number;
  limit: number;
  readonly sms?: {
    readonly ttlSeconds: number;
    readonly limit: number;
  };
  /** IP budget for the public survey submit (`POST /surveys/answer/public/*`). */
  readonly survey?: {
    readonly ttlSeconds: number;
    readonly limit: number;
  };
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
  docs?: DocsConfig;
}

export interface DocsServiceConfig {
  readonly name: string;
  /** 게이트웨이 기준 경로(`/` 로 시작). 외부 호스트는 허용하지 않는다. */
  readonly url: string;
}

/** 통합 API 문서 화면(`GET /docs`). 없거나 `enabled: false`면 완전히 꺼진다. */
export interface DocsConfig {
  readonly enabled: boolean;
  readonly title?: string;
  readonly services?: readonly DocsServiceConfig[];
}

export interface InstanceEnv {
  hostName: string;
  ipAddr: string;
  port: number;
}
