import {
  parseGatewayConfig,
  InvalidGatewayConfigError,
} from './gateway-config.validate';

const valid = {
  jwt: { publicKey: 'pem' },
  eureka: { serviceUrl: 'http://eureka:8761/eureka' },
};

describe('parseGatewayConfig', () => {
  it('accepts a minimal valid payload', () => {
    expect(() => parseGatewayConfig(valid)).not.toThrow();
  });

  it('accepts eureka.serviceUrl as an array', () => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        eureka: {
          serviceUrl: ['http://a:8761/eureka', 'http://b:8761/eureka'],
        },
      }),
    ).not.toThrow();
  });

  it('rejects a non-object payload', () => {
    expect(() => parseGatewayConfig(null)).toThrow(InvalidGatewayConfigError);
    expect(() => parseGatewayConfig('nope')).toThrow(InvalidGatewayConfigError);
  });

  it('rejects a missing jwt.publicKey', () => {
    expect(() => parseGatewayConfig({ ...valid, jwt: {} })).toThrow(
      InvalidGatewayConfigError,
    );
  });

  it('rejects a missing eureka.serviceUrl', () => {
    expect(() => parseGatewayConfig({ ...valid, eureka: {} })).toThrow(
      InvalidGatewayConfigError,
    );
  });

  it('rejects an empty eureka.serviceUrl array', () => {
    expect(() =>
      parseGatewayConfig({ ...valid, eureka: { serviceUrl: [] } }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('rejects a malformed routing.prefixes', () => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        routing: { default: 'expo-expo-server', prefixes: { a: 1 } },
      }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('rejects routing without a default', () => {
    expect(() =>
      parseGatewayConfig({ ...valid, routing: { prefixes: {} } }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('rejects a malformed rateLimit', () => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        rateLimit: { ttlSeconds: 'sixty', limit: 100 },
      }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('rejects a non-array publicPaths', () => {
    expect(() =>
      parseGatewayConfig({ ...valid, publicPaths: '/auth' }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('accepts a full payload with routing, rateLimit, and publicPaths', () => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        port: 3000,
        routing: {
          default: 'expo-expo-server',
          prefixes: { '/v1/forms': 'expo-form-server' },
        },
        rateLimit: { ttlSeconds: 60, limit: 100 },
        publicPaths: ['/auth'],
      }),
    ).not.toThrow();
  });
});
