import * as http from 'node:http';
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import { ExpressAdapter } from '@nestjs/platform-express';
import { parseGatewayConfig } from '../src/bootstrap/gateway-config.validate';
import {
  createTestApp,
  getHttpServer,
  instance,
} from './support/gateway-test-app';

describe('Public survey submit IP limit (e2e)', () => {
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
            '/surveys': 'expo-form-server',
            '/auth': 'expo-user-server',
          },
        },
        publicPaths: [
          '/surveys/public',
          '/surveys/answer/public',
          'POST /auth',
        ],
        rateLimit: {
          ttlSeconds: 60,
          limit: 100,
          survey: { ttlSeconds: 60, limit: 5 },
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

  it('opens the public survey routes without a token', async () => {
    const client = request.agent(getHttpServer(app));
    await client.get('/surveys/public/expo-1').expect(200);
    await client.post('/surveys/answer/public/expo-1').expect(200);
  });

  it('limits only submissions per IP and keeps the survey page loading', async () => {
    const server = getHttpServer(app);
    const client = request.agent(server).set('X-Forwarded-For', '203.0.113.10');
    for (let i = 0; i < 5; i += 1) {
      await client.post('/surveys/answer/public/expo-1').expect(200);
    }
    const response = await client
      .post('/surveys/answer/public/expo-1')
      .expect(429);
    expect(Number(response.headers['retry-after-survey'])).toBeGreaterThan(0);

    // The page itself and other IPs are unaffected.
    await client.get('/surveys/public/expo-1').expect(200);
    await request(server)
      .post('/surveys/answer/public/expo-1')
      .set('X-Forwarded-For', '203.0.113.11')
      .expect(200);
    expect(hits).toBe(7);
  });

  it.each([
    ['get', '/surveys/expo-1'],
    ['post', '/surveys/expo-1'],
    ['patch', '/surveys/expo-1'],
    ['get', '/surveys/qr/token'],
  ] as const)('keeps %s %s protected', async (method, path) => {
    const response = await request(getHttpServer(app))[method](path);
    expect(response.status).toBe(401);
    expect(hits).toBe(0);
  });
});
