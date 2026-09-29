import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import {
  createTestApp,
  getHttpServer,
  instance,
} from './support/gateway-test-app';
import type { GatewayConfig } from '../src/bootstrap/gateway-config.types';

describe('Rate limiting (e2e)', () => {
  let app: INestApplication;
  let stub: http.Server;
  let stubPort: number;

  beforeAll((done) => {
    stub = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    stub.listen(0, '127.0.0.1', () => {
      stubPort = (stub.address() as AddressInfo).port;
      done();
    });
  });

  afterAll((done) => {
    stub.close(done);
  });

  beforeEach(async () => {
    const gatewayConfig: GatewayConfig = {
      jwt: { publicKey: 'unused-in-this-test' },
      eureka: { serviceUrl: 'http://unused:8761/eureka' },
      routing: { default: 'expo-expo-server', prefixes: {} },
      rateLimit: { ttlSeconds: 60, limit: 2 },
      publicPaths: ['/'],
    };
    app = await createTestApp({
      gatewayConfig,
      eurekaInstances: [instance({ ipAddr: '127.0.0.1', port: stubPort })],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects the request beyond the configured limit with 429', async () => {
    const server = getHttpServer(app);
    await request(server).get('/anything').expect(200);
    await request(server).get('/anything').expect(200);
    await request(server).get('/anything').expect(429);
  });
});
