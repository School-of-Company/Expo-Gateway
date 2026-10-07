import * as http from 'node:http';
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import { ExpressAdapter } from '@nestjs/platform-express';
import { parseGatewayConfig } from '../src/bootstrap/gateway-config.validate';
import { GATEWAY_CONFIG } from '../src/config/gateway-config.module';
import type { GatewayConfig } from '../src/bootstrap/gateway-config.types';
import {
  createTestApp,
  getHttpServer,
  instance,
} from './support/gateway-test-app';

describe('SMS IP limit (e2e)', () => {
  let app: INestApplication;
  let upstream: http.Server;
  let hits: number;

  beforeEach(async () => {
    hits = 0;
    upstream = http.createServer((_req, res) => {
      hits += 1;
      res.end('ok');
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );
    const address = upstream.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an upstream TCP address');
    }
    app = await createTestApp({
      gatewayConfig: parseGatewayConfig({
        jwt: { publicKey: 'unused' },
        eureka: { serviceUrl: 'http://unused:8761/eureka' },
        routing: {
          prefixes: {
            '/sms': 'expo-notification-server',
            '/auth': 'expo-user-server',
          },
        },
        publicPaths: [
          'POST /sms',
          'POST /sms/verify',
          'GET /sms',
          'POST /auth',
        ],
        rateLimit: {
          ttlSeconds: 60,
          limit: 100,
          sms: { ttlSeconds: 60, limit: 10 },
        },
      }),
      eurekaInstances: [instance({ port: address.port })],
    });
    const adapter = app.getHttpAdapter();
    if (!(adapter instanceof ExpressAdapter)) {
      throw new Error('Expected the production Express adapter');
    }
    adapter.getInstance<Express>().set('trust proxy', 1);
  });

  afterEach(async () => {
    await app?.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('shares the SMS budget across methods and paths without limiting auth', async () => {
    const server = getHttpServer(app);
    const client = request.agent(server).set('X-Forwarded-For', '203.0.113.10');
    for (let i = 0; i < 8; i += 1) {
      await client
        .post('/sms')
        .set('X-Forwarded-For', `198.51.100.${i}, 203.0.113.10`)
        .expect(200);
    }
    await client.get('/sms?phoneNumber=01000000000').expect(200);
    await client.post('/sms/verify/').expect(200);
    const response = await client.post('/sms').expect(429);
    expect(Number(response.headers['retry-after-sms'])).toBeGreaterThan(0);
    expect(hits).toBe(10);
    await client.post('/auth').expect(200);
    await request(server)
      .post('/sms')
      .set('X-Forwarded-For', '203.0.113.11')
      .expect(200);
  });

  it('still enforces the global budget when the SMS policy is enabled', async () => {
    const client = request.agent(getHttpServer(app));
    await client.post('/sms').expect(200);
    for (let i = 0; i < 99; i += 1) {
      await client.post('/auth').expect(200);
    }

    await client.post('/sms').expect(429);
    expect(hits).toBe(100);
  });

  it('uses only the global budget when the SMS policy is omitted', async () => {
    const config = app.get<GatewayConfig>(GATEWAY_CONFIG);
    const address = upstream.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an upstream TCP address');
    }
    await app.close();
    app = await createTestApp({
      gatewayConfig: {
        ...config,
        rateLimit: { ttlSeconds: 60, limit: 12 },
      },
      eurekaInstances: [instance({ port: address.port })],
    });
    const client = request.agent(getHttpServer(app));
    for (let i = 0; i < 12; i += 1) {
      await client.post('/sms').expect(200);
    }

    await client.post('/sms').expect(429);
    expect(hits).toBe(12);
  });

  it.each([
    ['delete', '/sms'],
    ['head', '/sms'],
    ['options', '/sms'],
    ['get', '/sms/verify'],
    ['post', '/sms/admin'],
    ['post', '/sms/verify/more'],
    ['post', '/sms-other'],
  ] as const)('requires authentication for %s %s', async (method, path) => {
    const response = await request(getHttpServer(app))[method](path);
    expect(response.status).toBe(401);
    expect(hits).toBe(0);
  });
});
