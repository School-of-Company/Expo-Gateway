import { Inject, Injectable } from '@nestjs/common';
import type {
  DocsConfig,
  GatewayConfig,
  RateLimitConfig,
  RoutingConfig,
} from '../bootstrap/gateway-config.types';
import type { UpstreamPolicyConfig } from '../proxy/upstream-policy';
import { GATEWAY_CONFIG } from './gateway-config.tokens';
import { DEFAULT_RATE_LIMIT } from './gateway-config.defaults';

@Injectable()
export class GatewayConfigService {
  constructor(@Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig) {}

  getJwtPublicKey(): string {
    return this.config.jwt.publicKey;
  }

  getEureka() {
    return this.config.eureka;
  }

  getRouting(): RoutingConfig {
    return this.config.routing;
  }

  getRateLimit(): RateLimitConfig {
    return this.config.rateLimit ?? DEFAULT_RATE_LIMIT;
  }

  getPublicPaths(): string[] {
    return (
      this.config.publicPaths ?? [
        '/health',
        'POST /auth',
        'POST /auth/signin',
        'PATCH /auth',
      ]
    );
  }

  /** 통합 API 문서 설정. 꺼져 있거나 없으면 `undefined`. */
  getDocs(): DocsConfig | undefined {
    return this.config.docs?.enabled ? this.config.docs : undefined;
  }

  /** Exact allowed browser origins; `undefined` turns CORS and the `Origin` check off. */
  getCorsAllowedOrigins(): readonly string[] | undefined {
    return this.config.cors?.allowedOrigins;
  }

  getUpstream(): UpstreamPolicyConfig | undefined {
    return this.config.upstream;
  }

  getPort(): number | undefined {
    return this.config.port;
  }
}
