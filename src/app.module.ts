import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import {
  GatewayConfigModule,
  GATEWAY_CONFIG,
} from './config/gateway-config.module';
import type { GatewayConfig } from './bootstrap/gateway-config.types';
import { DEFAULT_RATE_LIMIT } from './config/gateway-config.defaults';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { MetricsModule } from './metrics/metrics.module';
import { ProxyModule } from './proxy/proxy.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    GatewayConfigModule.forRoot(),
    MetricsModule,
    ThrottlerModule.forRootAsync({
      inject: [GATEWAY_CONFIG],
      useFactory: (config: GatewayConfig) => [
        {
          ttl:
            (config.rateLimit?.ttlSeconds ?? DEFAULT_RATE_LIMIT.ttlSeconds) *
            1000,
          limit: config.rateLimit?.limit ?? DEFAULT_RATE_LIMIT.limit,
        },
      ],
    }),
    ProxyModule,
  ],
  controllers: [HealthController],
  providers: [
    // Registration order matters: Throttler rejects abusive traffic before
    // spending CPU on RS256 verification in JwtAuthGuard.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
