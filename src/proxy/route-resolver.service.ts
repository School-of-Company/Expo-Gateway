import { Injectable } from '@nestjs/common';
import { GatewayConfigService } from '../config/gateway-config.service';

@Injectable()
export class RouteResolverService {
  constructor(private readonly gatewayConfig: GatewayConfigService) {}

  /** Longest-matching-prefix wins; `undefined` when no configured prefix matches. */
  resolve(path: string): string | undefined {
    const { prefixes } = this.gatewayConfig.getRouting();

    let best: { prefix: string; appName: string } | undefined;
    for (const [prefix, appName] of Object.entries(prefixes)) {
      const matches =
        path === prefix ||
        path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
      if (matches && (!best || prefix.length > best.prefix.length)) {
        best = { prefix, appName };
      }
    }
    return best?.appName;
  }
}
