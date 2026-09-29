import { RouteResolverService } from './route-resolver.service';
import type { GatewayConfigService } from '../config/gateway-config.service';
import type { RoutingConfig } from '../bootstrap/gateway-config.types';

function makeResolver(routing: RoutingConfig): RouteResolverService {
  const gatewayConfig = {
    getRouting: () => routing,
  } as unknown as GatewayConfigService;
  return new RouteResolverService(gatewayConfig);
}

describe('RouteResolverService', () => {
  const routing: RoutingConfig = {
    prefixes: {
      '/forms': 'expo-form-server',
      '/forms/special': 'expo-special-form-server',
    },
  };

  it('resolves an exact prefix match', () => {
    const resolver = makeResolver(routing);
    expect(resolver.resolve('/forms')).toBe('expo-form-server');
  });

  it('resolves a sub-path under a prefix', () => {
    const resolver = makeResolver(routing);
    expect(resolver.resolve('/forms/123')).toBe('expo-form-server');
  });

  it('prefers the longest matching prefix on overlap', () => {
    const resolver = makeResolver(routing);
    expect(resolver.resolve('/forms/special/abc')).toBe(
      'expo-special-form-server',
    );
  });

  it('returns undefined when no prefix matches', () => {
    const resolver = makeResolver(routing);
    expect(resolver.resolve('/auth/login')).toBeUndefined();
  });

  it('does not treat a similarly-named path as a prefix match', () => {
    const resolver = makeResolver(routing);
    expect(resolver.resolve('/forms-extra')).toBeUndefined();
  });
});
