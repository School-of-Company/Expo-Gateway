import type { Server } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import {
  EurekaService,
  type EurekaInstance,
} from '@school-of-company/nestjs-eureka';
import { AppModule } from '../../src/app.module';
import { GATEWAY_APP_OPTIONS } from '../../src/bootstrap/app-options';
import {
  setGatewayConfig,
  resetGatewayConfigForTests,
} from '../../src/bootstrap/gateway-config-holder';
import type { GatewayConfig } from '../../src/bootstrap/gateway-config.types';
import { UPSTREAM_TIMEOUT_MS } from '../../src/proxy/upstream-timeout';

export interface TestAppOptions {
  gatewayConfig: GatewayConfig;
  eurekaInstances?: EurekaInstance[] | (() => Promise<EurekaInstance[]>);
  upstreamTimeoutMs?: number;
}

export async function createTestApp(
  options: TestAppOptions,
): Promise<INestApplication> {
  process.env.INSTANCE_HOSTNAME = 'test-gateway';
  process.env.INSTANCE_IP_ADDR = '127.0.0.1';

  resetGatewayConfigForTests();
  setGatewayConfig(options.gatewayConfig);

  const fakeEurekaService = {
    getInstances: jest.fn().mockImplementation(async () => {
      const instances = options.eurekaInstances ?? [];
      return typeof instances === 'function' ? instances() : instances;
    }),
  };

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EurekaService)
    .useValue(fakeEurekaService);
  if (options.upstreamTimeoutMs !== undefined) {
    builder = builder
      .overrideProvider(UPSTREAM_TIMEOUT_MS)
      .useValue(options.upstreamTimeoutMs);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication(GATEWAY_APP_OPTIONS);
  // Bind 127.0.0.1 ourselves: supertest's own `listen(0)` binds `::` but
  // connects to 127.0.0.1, so another process listening on 127.0.0.1 with the
  // same port number would answer instead of this app (#41).
  await app.listen(0, '127.0.0.1');
  return app;
}

/** `INestApplication.getHttpServer()` is typed `any` — supertest wants a `net.Server`. */
export function getHttpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

export function instance(overrides: Partial<EurekaInstance>): EurekaInstance {
  return {
    instanceId: 'id',
    app: 'TEST-SERVICE',
    hostName: 'host',
    ipAddr: '127.0.0.1',
    status: 'UP',
    port: 0,
    metadata: {},
    ...overrides,
  };
}
