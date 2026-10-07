import {
  parseGatewayConfig,
  InvalidGatewayConfigError,
} from './gateway-config.validate';

const valid = {
  jwt: { publicKey: 'pem' },
  eureka: { serviceUrl: 'http://eureka:8761/eureka' },
  routing: { prefixes: { '/forms': 'expo-form-server' } },
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

  it('rejects a missing routing', () => {
    expect(() =>
      parseGatewayConfig({ jwt: valid.jwt, eureka: valid.eureka }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('rejects a malformed routing.prefixes', () => {
    expect(() =>
      parseGatewayConfig({ ...valid, routing: { prefixes: { a: 1 } } }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('rejects an empty routing.prefixes', () => {
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

  it.each([
    null,
    {},
    '10',
    { ttlSeconds: 60, limit: 0 },
    { ttlSeconds: -1, limit: 10 },
    { ttlSeconds: 60, limit: 1.5 },
    { ttlSeconds: Infinity, limit: 10 },
    { ttlSeconds: 60, limit: '10' },
  ])('rejects malformed SMS policy %j at boot', (sms) => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        rateLimit: { ttlSeconds: 60, limit: 100, sms },
      }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('accepts "METHOD /path" entries in publicPaths', () => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        publicPaths: ['/health', 'POST /auth', 'PATCH /auth'],
      }),
    ).not.toThrow();
  });

  it('rejects a malformed "METHOD /path" entry in publicPaths', () => {
    expect(() =>
      parseGatewayConfig({ ...valid, publicPaths: ['post /auth'] }),
    ).toThrow(InvalidGatewayConfigError);
    expect(() =>
      parseGatewayConfig({ ...valid, publicPaths: ['POST auth'] }),
    ).toThrow(InvalidGatewayConfigError);
  });

  it('accepts a full payload with routing, rateLimit, and publicPaths', () => {
    expect(() =>
      parseGatewayConfig({
        ...valid,
        port: 3000,
        routing: { prefixes: { '/forms': 'expo-form-server' } },
        rateLimit: { ttlSeconds: 60, limit: 100 },
        publicPaths: ['/auth'],
      }),
    ).not.toThrow();
  });
});
