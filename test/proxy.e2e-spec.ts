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

describe('Proxy (e2e)', () => {
  let app: INestApplication;
  let stub: http.Server;
  let stubPort: number;

  beforeAll((done) => {
    stub = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ from: 'stub', path: req.url }));
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
      routing: {
        default: 'expo-expo-server',
        prefixes: { '/v1/forms': 'expo-form-server' },
      },
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

  it('proxies a request matching a configured prefix to the resolved instance', async () => {
    const res = await request(getHttpServer(app)).get('/v1/forms/123');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: 'stub', path: '/v1/forms/123' });
  });

  it('proxies an unmapped path via the routing default', async () => {
    const res = await request(getHttpServer(app)).get('/auth/login');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: 'stub', path: '/auth/login' });
  });
});
