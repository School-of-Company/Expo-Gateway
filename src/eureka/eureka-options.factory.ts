import type { EurekaModuleOptions } from '@school-of-company/nestjs-eureka';
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
    },
  };
}
