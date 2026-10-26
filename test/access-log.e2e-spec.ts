import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import * as request from 'supertest';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { parseGatewayConfig } from '../src/bootstrap/gateway-config.validate';
import { createPino, JsonLogger } from '../src/logging/json-logger';
import {
  createTestApp,
  getHttpServer,
  instance,
} from './support/gateway-test-app';

/**
 * The access log through the real HTTP stack: one standard JSON line per
 * request, with the routed Eureka app and without the query string.
 */
const FRONT = 'https://expo.example.com';
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

describe('HTTP access log (e2e)', () => {
  let upstream: http.Server;
  let app: INestApplication;
  let lines: Record<string, unknown>[];

  beforeAll(async () => {
    upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );
  });

  afterAll((done) => {
    Logger.overrideLogger(false);
    upstream.close(done);
  });

  beforeEach(async () => {
    lines = [];
    app = await createTestApp({
      gatewayConfig: parseGatewayConfig({
        jwt: { publicKey: publicKey.export({ type: 'spki', format: 'pem' }) },
        eureka: { serviceUrl: 'http://unused:8761/eureka' },
        routing: { prefixes: { '/forms': 'expo-form-server' } },
        publicPaths: ['GET /forms/{id}', 'GET /health'],
        rateLimit: { ttlSeconds: 60, limit: 1000 },
        cors: { allowedOrigins: [FRONT] },
      }),
      eurekaInstances: [
        instance({ port: (upstream.address() as AddressInfo).port }),
      ],
    });
    // After createTestApp: compiling the testing module installs its own logger.
    Logger.overrideLogger(
      new JsonLogger(
        createPino(
          { service: 'expo-gateway', level: 'info' },
          {
            write: (chunk: string) => {
              lines.push(JSON.parse(chunk) as Record<string, unknown>);
            },
          },
        ),
      ),
    );
  });

  afterEach(async () => {
    await app.close();
  });

  const accessLines = () => lines.filter((l) => l.module === 'HttpAccess');

  it('writes one standard JSON line for a proxied request', async () => {
    await request(getHttpServer(app))
      .get('/forms/123?phone=01012345678')
      .expect(200);

    const access = accessLines();
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({
      service: 'expo-gateway',
      module: 'HttpAccess',
      level: 'INFO',
    });
    expect(access[0].message).toMatch(
      /^GET \/forms\/123 200 \d+ms -> expo-form-server$/,
    );
    expect(JSON.stringify(access[0])).not.toContain('01012345678');
  });

  it('logs guard rejections and preflights, but not /health', async () => {
    await request(getHttpServer(app)).post('/forms/1').expect(401);
    await request(getHttpServer(app))
      .options('/forms/1')
      .set('Origin', FRONT)
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    await request(getHttpServer(app)).get('/health').expect(200);

    expect(accessLines().map((l) => [l.level, l.message])).toEqual([
      [
        'WARN',
        expect.stringMatching(
          /^POST \/forms\/1 401 \d+ms -> expo-form-server$/,
        ),
      ],
      [
        'INFO',
        expect.stringMatching(
          /^OPTIONS \/forms\/1 204 \d+ms -> expo-form-server$/,
        ),
      ],
    ]);
  });
});
