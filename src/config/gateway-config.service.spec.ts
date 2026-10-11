import { isPublicPath } from '../auth/public-path.matcher';
import type { GatewayConfig } from '../bootstrap/gateway-config.types';
import { GatewayConfigService } from './gateway-config.service';

const baseConfig: GatewayConfig = {
  jwt: { publicKey: 'public-key' },
  eureka: { serviceUrl: 'http://localhost:8761/eureka' },
  routing: { prefixes: { '/forms': 'expo-form-server' } },
};

describe('GatewayConfigService.getPublicPaths', () => {
  it('returns the configured list when present', () => {
    const service = new GatewayConfigService({
      ...baseConfig,
      publicPaths: ['/health', 'POST /auth'],
    });
    expect(service.getPublicPaths()).toEqual(['/health', 'POST /auth']);
  });

  describe('default (publicPaths omitted)', () => {
    const publicPaths = new GatewayConfigService(baseConfig).getPublicPaths();

    it('opens health, sign-up, sign-in and token reissue', () => {
      expect(isPublicPath('/health', publicPaths, 'GET')).toBe(true);
      expect(isPublicPath('/auth', publicPaths, 'POST')).toBe(true);
      expect(isPublicPath('/auth/signin', publicPaths, 'POST')).toBe(true);
      expect(isPublicPath('/auth', publicPaths, 'PATCH')).toBe(true);
    });

    it('keeps logout (DELETE /auth) protected', () => {
      expect(isPublicPath('/auth', publicPaths, 'DELETE')).toBe(false);
    });

    it('does not open other methods or sub-paths of /auth', () => {
      expect(isPublicPath('/auth', publicPaths, 'GET')).toBe(false);
      expect(isPublicPath('/auth/withdraw', publicPaths, 'POST')).toBe(false);
    });
  });
});
