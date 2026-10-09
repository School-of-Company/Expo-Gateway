import { Module } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerOptions } from '@nestjs/throttler';
import type { Request } from 'express';
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
      useFactory: (config: GatewayConfig): ThrottlerOptions[] => [
        {
          ttl:
            (config.rateLimit?.ttlSeconds ?? DEFAULT_RATE_LIMIT.ttlSeconds) *
            1000,
          limit: config.rateLimit?.limit ?? DEFAULT_RATE_LIMIT.limit,
        },
        ...(config.rateLimit?.sms
          ? [
              {
                name: 'sms',
                ttl: config.rateLimit.sms.ttlSeconds * 1000,
                limit: config.rateLimit.sms.limit,
                skipIf: (context: ExecutionContext) => {
                  const { path } = context.switchToHttp().getRequest<Request>();
                  return path !== '/sms' && !path.startsWith('/sms/');
                },
              },
            ]
          : []),
        ...(config.rateLimit?.survey
          ? [
              {
                name: 'survey',
                ttl: config.rateLimit.survey.ttlSeconds * 1000,
                limit: config.rateLimit.survey.limit,
                // Only submissions are budgeted: the survey page itself must
                // keep loading for people queueing at a shared booth IP.
                skipIf: (context: ExecutionContext) => {
                  const { method, path } = context
                    .switchToHttp()
                    .getRequest<Request>();
                  return (
                    method !== 'POST' ||
                    (path !== '/surveys/answer/public' &&
                      !path.startsWith('/surveys/answer/public/'))
                  );
                },
              },
            ]
          : []),
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
