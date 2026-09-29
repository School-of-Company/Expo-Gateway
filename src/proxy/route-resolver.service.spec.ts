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
    default: 'expo-expo-server',
    prefixes: {
      '/v1/forms': 'expo-form-server',
      '/v1/forms/special': 'expo-special-form-server',
    },
  };

  it('resolves an exact prefix match', () => {
    const resolver = makeResolver(routing);
    expect(resolver.resolve('/v1/forms')).toBe('expo-form-server');
  });

  it('resolves a sub-path under a prefix', () => {
    const resolver = makeResolver(routing);
    expect(resolver.resolve('/v1/forms/123')).toBe('expo-form-server');
  });

  it('prefers the longest matching prefix on overlap', () => {
    const resolver = makeResolver(routing);
    expect(resolver.resolve('/v1/forms/special/abc')).toBe(
      'expo-special-form-server',
    );
  });

  it('falls back to the default when nothing matches', () => {
    const resolver = makeResolver(routing);
    expect(resolver.resolve('/auth/login')).toBe('expo-expo-server');
  });

  it('does not treat a similarly-named path as a prefix match', () => {
    const resolver = makeResolver(routing);
    expect(resolver.resolve('/v1/forms-extra')).toBe('expo-expo-server');
  });
});
