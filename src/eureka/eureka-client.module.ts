import { Module } from '@nestjs/common';
import { EurekaModule } from '@school-of-company/nestjs-eureka';
import {
  GATEWAY_CONFIG,
  GatewayConfigModule,
} from '../config/gateway-config.module';
import type { GatewayConfig } from '../bootstrap/gateway-config.types';
import { readInstanceEnv, readMetricsBind } from '../bootstrap/env';
import { buildEurekaOptions } from './eureka-options.factory';

/**
 * Thin wrapper so `EurekaModule.forRootAsync()` is invoked exactly once
 * (calling it twice would start a second, independent registration/heartbeat
 * loop per the library's own docs) while still letting `EurekaService` be
 * injected from other feature modules (e.g. `ProxyModule`) — a plain
 * `@Module()` like this one is a singleton in Nest's DI graph regardless of
 * how many other modules import it, unlike re-invoking a dynamic module's
 * `forRootAsync` from each consumer.
 */
@Module({
  imports: [
    GatewayConfigModule,
    EurekaModule.forRootAsync({
      inject: [GATEWAY_CONFIG],
      useFactory: (config: GatewayConfig) =>
        buildEurekaOptions(config, readInstanceEnv(), readMetricsBind()),
    }),
  ],
  exports: [EurekaModule],
})
export class EurekaClientModule {}
