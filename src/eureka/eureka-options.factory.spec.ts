import {
  buildEurekaOptions,
  GATEWAY_EUREKA_APP_NAME,
} from './eureka-options.factory';
import type {
  GatewayConfig,
  InstanceEnv,
} from '../bootstrap/gateway-config.types';

describe('buildEurekaOptions', () => {
  const config: GatewayConfig = {
    jwt: { publicKey: 'pem' },
    routing: { prefixes: {} },
    eureka: { serviceUrl: 'http://eureka:8761/eureka' },
  };

  it.each([
    ['127.0.0.1', '127.0.0.1', 18206],
    ['10.0.0.9', '10.0.0.9', 18106],
    ['0.0.0.0', '10.0.0.9', 9464],
    ['::', '::1', 9464],
    ['::', '10.0.0.9', 9464],
  ])('advertises reachable metrics on %s for %s:%s', (host, ipAddr, port) => {
    expect(
      buildEurekaOptions(config, { ...instanceEnv, ipAddr }, { host, port })
        .instance.metadata,
    ).toEqual({
      'prometheus.scrape': 'true',
      'prometheus.port': String(port),
      'prometheus.path': '/metrics',
    });
  });

  it.each([
    ['127.0.0.1', '10.0.0.9', 18206],
    ['10.0.0.8', '10.0.0.9', 18106],
    ['0.0.0.0', '::1', 9464],
    ['127.0.0.1', '127.0.0.1', 0],
  ])(
    'omits metadata for unmatched or ephemeral bind %s/%s:%s',
    (host, ipAddr, port) => {
      expect(
        buildEurekaOptions(config, { ...instanceEnv, ipAddr }, { host, port })
          .instance.metadata,
      ).toBeUndefined();
    },
  );

  it('omits metadata when metrics are disabled', () => {
    expect(
      buildEurekaOptions(config, instanceEnv).instance.metadata,
    ).toBeUndefined();
  });
  const instanceEnv: InstanceEnv = {
    hostName: 'gateway-1',
    ipAddr: '10.0.0.9',
    port: 3000,
  };

  it('always uses the fixed gateway app name, regardless of input', () => {
    const config: GatewayConfig = {
      jwt: { publicKey: 'pem' },
      routing: { prefixes: { '/forms': 'expo-form-server' } },
      eureka: { serviceUrl: 'http://eureka:8761/eureka' },
    };

    const options = buildEurekaOptions(config, instanceEnv);

    expect(options.instance.app).toBe(GATEWAY_EUREKA_APP_NAME);
    expect(options.instance.app).toBe('expo-gateway');
  });

  it('maps instance identity from env and eureka tuning values from config', () => {
    const config: GatewayConfig = {
      jwt: { publicKey: 'pem' },
      routing: { prefixes: { '/forms': 'expo-form-server' } },
      eureka: {
        serviceUrl: ['http://a:8761/eureka', 'http://b:8761/eureka'],
        heartbeatIntervalSeconds: 10,
        leaseDurationSeconds: 30,
        requestTimeoutMs: 2000,
      },
    };

    const options = buildEurekaOptions(config, instanceEnv);

    expect(options.serviceUrl).toEqual([
      'http://a:8761/eureka',
      'http://b:8761/eureka',
    ]);
    expect(options.heartbeatIntervalSeconds).toBe(10);
    expect(options.leaseDurationSeconds).toBe(30);
    expect(options.requestTimeoutMs).toBe(2000);
    expect(options.instance).toEqual({
      app: 'expo-gateway',
      hostName: 'gateway-1',
      ipAddr: '10.0.0.9',
      port: 3000,
    });
  });
});
