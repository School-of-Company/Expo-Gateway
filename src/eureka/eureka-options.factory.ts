import type { EurekaModuleOptions } from '@school-of-company/nestjs-eureka';
import type {
  GatewayConfig,
  InstanceEnv,
} from '../bootstrap/gateway-config.types';
import type { MetricsBind } from '../bootstrap/env';

/** This gateway's own Eureka application name — fixed, not configurable. */
export const GATEWAY_EUREKA_APP_NAME = 'expo-gateway';

/**
 * Eureka metadata that Expo-Monitoring's Prometheus uses to discover scrape
 * targets (`prometheus.scrape` / `prometheus.port` / `prometheus.path`).
 * Prometheus scrapes `ipAddr:prometheus.port`, so the metadata is only
 * advertised when the metrics listener is actually bound on that address
 * (the registered `ipAddr`, or all interfaces). Advertising a loopback-only
 * listener under a non-loopback `ipAddr` would just show up as a down target.
 */
export function buildPrometheusMetadata(
  instance: InstanceEnv,
  metrics: MetricsBind,
): Record<string, string> {
  const reachable =
    metrics.host === '0.0.0.0' ||
    metrics.host === '::' ||
    metrics.host === instance.ipAddr;
  if (!reachable) {
    return {};
  }
  return {
    'prometheus.scrape': 'true',
    'prometheus.port': String(metrics.port),
    'prometheus.path': '/metrics',
  };
}

/** Pure function so it's unit-testable without booting Nest or Eureka. */
export function buildEurekaOptions(
  config: GatewayConfig,
  instance: InstanceEnv,
  metrics: MetricsBind,
): EurekaModuleOptions {
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
      metadata: buildPrometheusMetadata(instance, metrics),
    },
  };
}
