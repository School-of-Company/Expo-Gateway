import * as http from 'node:http';
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { parseGatewayConfig } from '../src/bootstrap/gateway-config.validate';
import {
  createTestApp,
  getHttpServer,
  instance,
} from './support/gateway-test-app';

// supertest connects from 127.0.0.1, i.e. it plays Apache on the same host.
const NEXT = '198.51.100.7';
const LIMIT = 3;

describe('Trusted proxies and the signin IP budget (e2e)', () => {
  let app: INestApplication;
  let upstream: http.Server;

  beforeEach(async () => {
    upstream = http.createServer((_req, res) => res.end('ok'));
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
      publicPaths: ['POST /auth/signin'],
      rateLimit: {
        ttlSeconds: 60,
        limit: 100,
        signin: { ttlSeconds: 60, limit: LIMIT },
      },
      trustedProxies: [NEXT],
    });
    app = await createTestApp({
      gatewayConfig,
      eurekaInstances: [instance({ port: address.port })],
    });
  });

  afterEach(async () => {
    await app?.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const signin = (xff: string) =>
    request(getHttpServer(app))
      .post('/auth/signin')
      .set('X-Forwarded-For', xff);

  it('gives each user behind Next its own budget', async () => {
    for (let i = 0; i < LIMIT; i += 1) {
      await signin(`203.0.113.10, ${NEXT}`).expect(200);
    }
    await signin(`203.0.113.10, ${NEXT}`).expect(429);
    await signin(`203.0.113.11, ${NEXT}`).expect(200);
    await signin(`203.0.113.12, ::ffff:${NEXT}`).expect(200);
  });

  it('counts a forged X-Forwarded-For sent straight to Apache against the real peer', async () => {
    // Apache appends the real peer (198.51.100.66) after the forged value.
    for (let i = 0; i < LIMIT; i += 1) {
      await signin(`10.0.0.${i}, 198.51.100.66`).expect(200);
    }
    await signin('10.0.0.99, 198.51.100.66').expect(429);
  });

  it('stops at an untrusted hop instead of reading past it', async () => {
    for (let i = 0; i < LIMIT; i += 1) {
      await signin(`10.0.0.${i}, 192.0.2.50, ${NEXT}`).expect(200);
    }
    await signin(`10.0.0.99, 192.0.2.50, ${NEXT}`).expect(429);
  });
});
