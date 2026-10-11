import { DynamicModule, Global, Module } from '@nestjs/common';
import { getGatewayConfig } from '../bootstrap/gateway-config-holder';
import { GatewayConfigService } from './gateway-config.service';
import { GATEWAY_CONFIG } from './gateway-config.tokens';

export { GATEWAY_CONFIG } from './gateway-config.tokens';

/**
 * @Global() because the fetched gateway config (JWT public key, routing
 * table, rate limit, public paths) is needed pervasively — the auth guard,
 * the throttler factory, and the proxy's route resolver/load balancer all
 * need it, and there's no meaningful "feature" boundary to scope it to.
 */
@Global()
@Module({})
export class GatewayConfigModule {
  static forRoot(): DynamicModule {
    return {
      module: GatewayConfigModule,
      providers: [
        { provide: GATEWAY_CONFIG, useFactory: getGatewayConfig },
        GatewayConfigService,
      ],
      exports: [GATEWAY_CONFIG, GatewayConfigService],
    };
  }
}
