import {
  buildEurekaOptions,
  buildPrometheusMetadata,
  GATEWAY_EUREKA_APP_NAME,
} from './eureka-options.factory';
import type {
  GatewayConfig,
  InstanceEnv,
} from '../bootstrap/gateway-config.types';
import type { MetricsBind } from '../bootstrap/env';

describe('buildEurekaOptions', () => {
  const instanceEnv: InstanceEnv = {
    hostName: 'gateway-1',
    ipAddr: '10.0.0.9',
    port: 3000,
  };
  const loopbackMetrics: MetricsBind = { host: '127.0.0.1', port: 9464 };

  it('always uses the fixed gateway app name, regardless of input', () => {
    const config: GatewayConfig = {
      jwt: { publicKey: 'pem' },
      routing: { prefixes: { '/forms': 'expo-form-server' } },
      eureka: { serviceUrl: 'http://eureka:8761/eureka' },
    };

    const options = buildEurekaOptions(config, instanceEnv, loopbackMetrics);

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

    const options = buildEurekaOptions(config, instanceEnv, loopbackMetrics);

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
      metadata: {},
    });
  });

  it('passes the prometheus metadata into the registered instance', () => {
    const config: GatewayConfig = {
      jwt: { publicKey: 'pem' },
      routing: { prefixes: {} },
      eureka: { serviceUrl: 'http://eureka:8761/eureka' },
    };

    const options = buildEurekaOptions(
      config,
      { hostName: '127.0.0.1', ipAddr: '127.0.0.1', port: 18200 },
      { host: '127.0.0.1', port: 18206 },
    );

    expect(options.instance.metadata).toEqual({
      'prometheus.scrape': 'true',
      'prometheus.port': '18206',
      'prometheus.path': '/metrics',
    });
  });
});

describe('buildPrometheusMetadata', () => {
  const instance: InstanceEnv = {
    hostName: 'gateway-1',
    ipAddr: '10.0.0.9',
    port: 3000,
  };
  const advertised = {
    'prometheus.scrape': 'true',
    'prometheus.port': '9464',
    'prometheus.path': '/metrics',
  };

  it('advertises the metrics port when it listens on the registered ipAddr', () => {
    expect(
      buildPrometheusMetadata(instance, { host: '10.0.0.9', port: 9464 }),
    ).toEqual(advertised);
  });

  it('advertises the metrics port when it listens on all interfaces', () => {
    expect(
      buildPrometheusMetadata(instance, { host: '0.0.0.0', port: 9464 }),
    ).toEqual(advertised);
  });

  it('does not advertise a loopback-only listener under a non-loopback ipAddr', () => {
    expect(
      buildPrometheusMetadata(instance, { host: '127.0.0.1', port: 9464 }),
    ).toEqual({});
  });
});
