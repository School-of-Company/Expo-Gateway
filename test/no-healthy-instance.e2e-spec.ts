import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import {
  createTestApp,
  getHttpServer,
  instance,
} from './support/gateway-test-app';
import type { GatewayConfig } from '../src/bootstrap/gateway-config.types';

const gatewayConfig: GatewayConfig = {
  jwt: { publicKey: 'unused-in-this-test' },
  eureka: { serviceUrl: 'http://unused:8761/eureka' },
  routing: { prefixes: { '/anything': 'expo-form-server' } },
  publicPaths: ['/'],
};

describe('No healthy instance (e2e)', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it('responds 503 when Eureka reports zero instances', async () => {
    app = await createTestApp({ gatewayConfig, eurekaInstances: [] });
    const res = await request(getHttpServer(app)).get('/anything');
    expect(res.status).toBe(503);
  });

  it('responds 503 when every instance is DOWN', async () => {
    app = await createTestApp({
      gatewayConfig,
      eurekaInstances: [instance({ status: 'DOWN' })],
    });
    const res = await request(getHttpServer(app)).get('/anything');
    expect(res.status).toBe(503);
  });

  it('responds 502 when the Eureka lookup itself fails', async () => {
    app = await createTestApp({
      gatewayConfig,
      eurekaInstances: () => Promise.reject(new Error('network error')),
    });
    const res = await request(getHttpServer(app)).get('/anything');
    expect(res.status).toBe(502);
  });
});
