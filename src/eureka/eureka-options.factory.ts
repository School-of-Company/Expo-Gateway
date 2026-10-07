import type { EurekaModuleOptions } from '@school-of-company/nestjs-eureka';
import { isIP } from 'node:net';
import type { MetricsBind } from '../bootstrap/env';
import type {
  GatewayConfig,
  InstanceEnv,
} from '../bootstrap/gateway-config.types';

/** This gateway's own Eureka application name — fixed, not configurable. */
export const GATEWAY_EUREKA_APP_NAME = 'expo-gateway';

/** Pure function so it's unit-testable without booting Nest or Eureka. */
export function buildEurekaOptions(
  config: GatewayConfig,
  instance: InstanceEnv,
  metricsBind?: MetricsBind,
): EurekaModuleOptions {
  const metricsReachable =
    metricsBind &&
    metricsBind.port > 0 &&
    (metricsBind.host === instance.ipAddr ||
      (metricsBind.host === '0.0.0.0' && isIP(instance.ipAddr) === 4) ||
      (metricsBind.host === '::' && isIP(instance.ipAddr) > 0));
  return {
    serviceUrl: config.eureka.serviceUrl,
    heartbeatIntervalSeconds: config.eureka.heartbeatIntervalSeconds,
    leaseDurationSeconds: config.eureka.leaseDurationSeconds,
    requestTimeoutMs: config.eureka.requestTimeoutMs,
    instance: {
      app: GATEWAY_EUREKA_APP_NAME,
      hostName: instance.hostName,
      ipAddr: instance.ipAddr,
      port: instance.port,
      ...(metricsReachable && {
        metadata: {
          'prometheus.scrape': 'true',
          'prometheus.port': String(metricsBind.port),
          'prometheus.path': '/metrics',
        },
      }),
    },
  };
}
