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
  /** IP budget for `POST /participant-auth/code` (each call sends an SMS). */
  readonly participantAuthCode?: {
    readonly ttlSeconds: number;
    readonly limit: number;
  };
  /** IP budget for `POST /auth/signin` (brute-force guard; the User Server has no lockout). */
  readonly signin?: {
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
  cors?: CorsConfig;
  /**
   * Proxies trusted for X-Forwarded-For besides loopback (`"IP"` or
   * `"IP/prefix"`). See `bootstrap/trust-proxy.ts`.
   */
  trustedProxies?: string[];
  /** Expo-Client BFF trust. See `proxy/client-ip.ts`. */
  bff?: BffConfig;
}

export interface BffConfig {
  /**
   * Shared secret the BFF sends as `X-Bff-Token`. Merged from Vault
   * `secret/gateway`, never logged. Absent = the header is ignored.
   */
  readonly token?: string;
}

/**
 * Credentialed CORS for browser clients (participant session cookie). Exact
 * origins only (`https://expo.example.com`), never `*`. Absent = the gateway
 * sends no CORS headers and does no `Origin` check, as before.
 */
export interface CorsConfig {
  readonly allowedOrigins: readonly string[];
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
  /**
   * `true`이면 `basicAuth`가 반드시 있어야 부팅한다. 비밀(Vault)이 빠졌을 때 문서가
   * 인증 없이 열리지 않게 하는 운영용 안전장치다. 기본은 `false`(dev).
   */
  readonly requireAuth?: boolean;
  /**
   * 문서 전용 HTTP Basic 자격 증명. 있으면 `/docs`와 `docs.services[].url`의 조회에
   * JWT 대신 이 자격 증명을 요구한다. 값은 Vault에서 병합되며 로그·응답에 싣지 않는다.
   */
  readonly basicAuth?: DocsBasicAuthConfig;
  /** `false`이면 문서 화면에서 `Try it out`을 막는다. 기본은 `true`. */
  readonly tryItOut?: boolean;
}

export interface DocsBasicAuthConfig {
  readonly username: string;
  readonly password: string;
}

export interface InstanceEnv {
  hostName: string;
  ipAddr: string;
  port: number;
}
