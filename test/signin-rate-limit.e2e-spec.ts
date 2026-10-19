import * as http from 'node:http';
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { parseGatewayConfig } from '../src/bootstrap/gateway-config.validate';
import {
  createTestApp,
  getHttpServer,
  instance,
} from './support/gateway-test-app';

describe('Signin IP limit (e2e)', () => {
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
        routing: { prefixes: { '/auth': 'expo-user-server' } },
        publicPaths: ['POST /auth', 'POST /auth/signin', 'PATCH /auth'],
        rateLimit: {
          ttlSeconds: 60,
          limit: 100,
          signin: { ttlSeconds: 60, limit: 3 },
        },
      }),
      eurekaInstances: [instance({ port: address.port })],
    });
  });

  afterEach(async () => {
    await app?.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('limits only the login call per IP and answers 429 with Retry-After-signin', async () => {
    const server = getHttpServer(app);
    const client = request.agent(server).set('X-Forwarded-For', '203.0.113.10');
    for (let i = 0; i < 3; i += 1) {
      await client.post('/auth/signin').expect(200);
    }
    const response = await client.post('/auth/signin').expect(429);
    expect(Number(response.headers['retry-after-signin'])).toBeGreaterThan(0);

    // Other /auth calls and other IPs are unaffected.
    await client.post('/auth').expect(200);
    await request(server)
      .post('/auth/signin')
      .set('X-Forwarded-For', '203.0.113.11')
      .expect(200);
    expect(hits).toBe(5);
  });

  it.each(['/auth/%73ignin', '/auth/signin;x=1', '/auth/signin/'])(
    'counts the encoded or decorated variant %s against the same budget',
    async (path) => {
      const client = request
        .agent(getHttpServer(app))
        .set('X-Forwarded-For', '203.0.113.20');
      for (let i = 0; i < 3; i += 1) {
        await client.post('/auth/signin').expect(200);
      }
      await client.post(path).expect(429);
    },
  );
});
