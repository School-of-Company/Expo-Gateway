import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { Server } from 'node:http';
import type { Express } from 'express';
import { AppModule } from '../app.module';
import { GATEWAY_APP_OPTIONS } from './app-options';
import { fetchGatewayConfig } from './fetch-gateway-config';
import { setGatewayConfig } from './gateway-config-holder';
import { MetricsService } from '../metrics/metrics.service';
import { startMetricsServer } from '../metrics/metrics.server';
import { readBootEnv, readMetricsBind, readMetricsEnabled } from './env';
import type { GatewayConfig } from './gateway-config.types';
import { setMetricsRuntime } from './metrics-runtime-holder';

export async function runBootstrap(
  exit: (code: number) => void = (code) => process.exit(code),
): Promise<void> {
  const logger = new Logger('Bootstrap');
  const env = readBootEnv();
  const metricsBind = readMetricsEnabled() ? readMetricsBind() : undefined;
  setMetricsRuntime(undefined);

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

  const metrics = new MetricsService();
  let metricsServer: Server | undefined;
  setMetricsRuntime({ service: metrics });
  if (metricsBind) {
    try {
      metricsServer = await startMetricsServer(
        metrics,
        metricsBind.port,
        metricsBind.host,
      );
      setMetricsRuntime({ service: metrics, bind: metricsBind });
      logger.log(
        `Metrics listening on ${metricsBind.host}:${metricsBind.port}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        `Metrics server failed to start; continuing without it: ${message}`,
      );
    }
  }

  try {
    const app = await NestFactory.create(AppModule, GATEWAY_APP_OPTIONS);
    app.enableShutdownHooks();
    (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);
    (app.getHttpServer() as Server).once('close', () => metricsServer?.close());
    await app.listen(resolvedPort);
  } catch (err) {
    metricsServer?.close();
    setMetricsRuntime(undefined);
    throw err;
  }
}
