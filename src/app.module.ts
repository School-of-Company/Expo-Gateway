import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
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
import { CorsMiddleware } from './cors/cors.middleware';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { MetricsModule } from './metrics/metrics.module';
import { ProxyModule } from './proxy/proxy.module';
import { DocsController } from './docs/docs.controller';
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
        ...(config.rateLimit?.participantAuthCode
          ? [
              {
                name: 'participantAuthCode',
                ttl: config.rateLimit.participantAuthCode.ttlSeconds * 1000,
                limit: config.rateLimit.participantAuthCode.limit,
                // Each call sends an SMS. The per-phone-number limit lives in
                // User Server (the gateway never reads bodies); this is per IP.
                skipIf: (context: ExecutionContext) => {
                  const { method, path } = context
                    .switchToHttp()
                    .getRequest<Request>();
                  // Compare what the backend will route (`%63ode`, `code;x`).
                  let target = path;
                  try {
                    target = decodeURIComponent(path);
                  } catch {
                    // Undecodable: the proxy answers 404 without forwarding.
                  }
                  target = target.split(';')[0].replace(/\/+$/, '');
                  return (
                    method !== 'POST' || target !== '/participant-auth/code'
                  );
                },
              },
            ]
          : []),
      ],
    }),
    ProxyModule,
  ],
  controllers: [HealthController, DocsController],
  providers: [
    // Registration order matters: Throttler rejects abusive traffic before
    // spending CPU on RS256 verification in JwtAuthGuard.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    CorsMiddleware,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Middleware runs before guards, so preflights and foreign-origin writes
    // are settled before the throttler or JWT verification see them.
    consumer.apply(CorsMiddleware).forRoutes('{*splat}');
  }
}
