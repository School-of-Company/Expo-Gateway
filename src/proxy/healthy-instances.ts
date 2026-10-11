import type { EurekaInstance } from '@school-of-company/nestjs-eureka';

/** `UP` in Eureka and plain-HTTP reachable (the gateway proxies over HTTP only). */
export function healthyInstances(
  instances: EurekaInstance[],
): EurekaInstance[] {
  return instances.filter(
    (instance) => instance.status === 'UP' && typeof instance.port === 'number',
  );
}
