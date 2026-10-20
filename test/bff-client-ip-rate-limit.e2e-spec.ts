import * as http from 'node:http';
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { parseGatewayConfig } from '../src/bootstrap/gateway-config.validate';
import {
  createTestApp,
  getHttpServer,
  instance,
} from './support/gateway-test-app';

// supertest connects from 127.0.0.1, i.e. it plays Apache on the same host,
// which appends the BFF's (Vercel, not in trustedProxies) address.
const VERCEL = '198.51.100.7';
const TOKEN = 't'.repeat(48);
const LIMIT = 3;

describe('BFF token and the client IP for rate limits (e2e)', () => {
  let app: INestApplication;
  let upstream: http.Server;
  let upstreamHeaders: http.IncomingHttpHeaders[];

  const start = async (bff: unknown) => {
    upstreamHeaders = [];
    upstream = http.createServer((req, res) => {
      upstreamHeaders.push(req.headers);
      res.end('ok');
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );
    const address = upstream.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an upstream TCP address');
    }
    const gatewayConfig = parseGatewayConfig({
      jwt: { publicKey: 'unused' },
      eureka: { serviceUrl: 'http://unused:8761/eureka' },
      routing: { prefixes: { '/auth': 'expo-user-server' } },
      publicPaths: ['/auth'],
      rateLimit: {
        ttlSeconds: 60,
        limit: LIMIT,
        signin: { ttlSeconds: 60, limit: 1 },
      },
      ...(bff === undefined ? {} : { bff }),
    });
    app = await createTestApp({
      gatewayConfig,
      eurekaInstances: [instance({ port: address.port })],
    });
  };

  afterEach(async () => {
    await app?.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const call = (
    method: 'get' | 'post',
    path: string,
    user: string,
    token?: string,
  ) => {
    const req = request(getHttpServer(app))
      [method](path)
      .set('X-Forwarded-For', `${user}, ${VERCEL}`);
    return token === undefined ? req : req.set('X-Bff-Token', token);
  };

  describe('with bff.token configured', () => {
    beforeEach(() => start({ token: TOKEN }));

    it('gives each user behind the BFF its own default budget', async () => {
      for (let i = 0; i < LIMIT; i += 1) {
        await call('get', '/auth/me', '203.0.113.10', TOKEN).expect(200);
      }
      await call('get', '/auth/me', '203.0.113.10', TOKEN).expect(429);
      await call('get', '/auth/me', '203.0.113.11', TOKEN).expect(200);
    });

    it('applies the same client IP to named budgets (signin)', async () => {
      await call('post', '/auth/signin', '203.0.113.10', TOKEN).expect(200);
      await call('post', '/auth/signin', '203.0.113.10', TOKEN).expect(429);
      await call('post', '/auth/signin', '203.0.113.11', TOKEN).expect(200);
    });

    it('counts a missing or wrong token against the BFF hop', async () => {
      for (let i = 0; i < LIMIT; i += 1) {
        await call('get', '/auth/me', `203.0.113.${i}`, 'wrong').expect(200);
      }
      await call('get', '/auth/me', '203.0.113.99').expect(429);
    });

    it('does not forward X-Bff-Token downstream', async () => {
      await call('get', '/auth/me', '203.0.113.10', TOKEN).expect(200);
      expect(upstreamHeaders[0]['x-bff-token']).toBeUndefined();
    });
  });

  describe('without bff.token', () => {
    beforeEach(() => start({}));

    it('ignores the header and keeps the shared BFF budget', async () => {
      for (let i = 0; i < LIMIT; i += 1) {
        await call('get', '/auth/me', `203.0.113.${i}`, TOKEN).expect(200);
      }
      await call('get', '/auth/me', '203.0.113.99', TOKEN).expect(429);
      expect(upstreamHeaders[0]['x-bff-token']).toBeUndefined();
    });
  });
});
