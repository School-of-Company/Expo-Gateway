import { Inject, Injectable } from '@nestjs/common';
import type {
  GatewayConfig,
  RateLimitConfig,
  RoutingConfig,
} from '../bootstrap/gateway-config.types';
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

  getPort(): number | undefined {
    return this.config.port;
  }
}
