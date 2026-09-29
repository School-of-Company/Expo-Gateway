import type { GatewayConfig } from './gateway-config.types';

/**
 * Plain module-scope singleton — deliberately NOT a Nest provider. It exists
 * to bridge the config fetched in `run.ts` (before `NestFactory.create()`,
 * i.e. before Nest's DI container exists) into Nest's DI graph via
 * `GatewayConfigModule`'s `useFactory: getGatewayConfig`, which only runs
 * once Nest actually instantiates that provider.
 */
let current: GatewayConfig | undefined;

export function setGatewayConfig(config: GatewayConfig): void {
  current = config;
}

export function getGatewayConfig(): GatewayConfig {
  if (!current) {
    throw new Error(
      'GatewayConfig accessed before bootstrap set it — setGatewayConfig() must run before NestFactory.create().',
    );
  }
  return current;
}

/** Test-only: reset the singleton between test cases. */
export function resetGatewayConfigForTests(): void {
  current = undefined;
}
