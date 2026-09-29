import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { Express } from 'express';
import { AppModule } from '../app.module';
import { fetchGatewayConfig } from './fetch-gateway-config';
import { setGatewayConfig } from './gateway-config-holder';
import { readBootEnv } from './env';
import type { GatewayConfig } from './gateway-config.types';

export async function runBootstrap(
  exit: (code: number) => void = (code) => process.exit(code),
): Promise<void> {
  const logger = new Logger('Bootstrap');
  const env = readBootEnv();

  let config: GatewayConfig;
  try {
    config = await fetchGatewayConfig(env.configServerUrl, env.profile);
  } catch (err) {
    logger.error(
      `Config Server fetch failed for gateway/${env.profile}: ${(err as Error).message}`,
    );
    exit(1);
    return;
  }
  setGatewayConfig(config);

  // Normalize once so app.listen() and this instance's Eureka registration
  // (readInstanceEnv() in eureka-options.factory.ts) agree on the same port.
  const resolvedPort = Number(process.env.PORT) || config.port || 3000;
  process.env.PORT = String(resolvedPort);

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);
  await app.listen(resolvedPort);
}
