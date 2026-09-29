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
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            from: 'stub',
            path: req.url,
            method: req.method,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      });
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
        prefixes: {
          '/forms': 'expo-form-server',
          '/auth': 'expo-auth-server',
        },
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
    const res = await request(getHttpServer(app)).get('/forms/123');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: 'stub', path: '/forms/123' });
  });

  it('proxies a request under a second configured prefix', async () => {
    const res = await request(getHttpServer(app)).get('/auth/login');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: 'stub', path: '/auth/login' });
  });

  it('forwards a POST JSON body to the upstream unchanged', async () => {
    const payload = { email: 'a@b.c', password: 'secret' };
    const res = await request(getHttpServer(app))
      .post('/auth/login')
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ method: 'POST', path: '/auth/login' });
    expect(JSON.parse((res.body as { body: string }).body)).toEqual(payload);
  });

  it('reuses one proxy instance instead of adding a server listener per request', async () => {
    const server = getHttpServer(app);
    await request(server).get('/forms/warmup').expect(200);
    const listenersAfterFirst = server.listenerCount('close');
    for (let i = 0; i < 15; i++) {
      await request(server).get(`/forms/${i}`).expect(200);
    }
    expect(server.listenerCount('close')).toBe(listenersAfterFirst);
  });

  it('responds 404 for a path that matches no configured prefix', async () => {
    const res = await request(getHttpServer(app)).get('/unknown/thing');
    expect(res.status).toBe(404);
  });
});
