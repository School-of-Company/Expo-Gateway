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

export interface TestAppOptions {
  gatewayConfig: GatewayConfig;
  eurekaInstances?: EurekaInstance[] | (() => Promise<EurekaInstance[]>);
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

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EurekaService)
    .useValue(fakeEurekaService)
    .compile();

  const app = moduleRef.createNestApplication(GATEWAY_APP_OPTIONS);
  await app.init();
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
