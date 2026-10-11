import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import {
  createTestApp,
  getHttpServer,
  instance,
} from './support/gateway-test-app';
import type { GatewayConfig } from '../src/bootstrap/gateway-config.types';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const publicKeyPem = publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();
const privateKeyPem = privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();

describe('Method-aware public paths (e2e)', () => {
  let app: INestApplication;
  let stub: http.Server;
  let stubPort: number;

  beforeAll((done) => {
    stub = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ xUserId: req.headers['x-user-id'] ?? null }));
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
      jwt: { publicKey: publicKeyPem },
      eureka: { serviceUrl: 'http://unused:8761/eureka' },
      routing: { prefixes: { '/auth': 'expo-user-server' } },
      publicPaths: ['POST /auth', 'POST /auth/signin', 'PATCH /auth'],
    };
    app = await createTestApp({
      gatewayConfig,
      eurekaInstances: [instance({ ipAddr: '127.0.0.1', port: stubPort })],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const signToken = () =>
    jwt.sign({ sub: '7' }, privateKeyPem, {
      algorithm: 'RS256',
      expiresIn: '5m',
    });

  it('lets sign-up, sign-in and token reissue through without a token', async () => {
    const server = getHttpServer(app);
    expect((await request(server).post('/auth')).status).toBe(200);
    expect((await request(server).post('/auth/signin')).status).toBe(200);
    expect((await request(server).patch('/auth')).status).toBe(200);
  });

  it('requires a token for logout (DELETE /auth)', async () => {
    const res = await request(getHttpServer(app)).delete('/auth');
    expect(res.status).toBe(401);
  });

  it('forwards the caller identity on logout', async () => {
    const res = await request(getHttpServer(app))
      .delete('/auth')
      .set('Authorization', `Bearer ${signToken()}`);
    expect(res.status).toBe(200);
    expect((res.body as { xUserId: string | null }).xUserId).toBe('7');
  });

  it('does not make other methods or sub-paths public', async () => {
    const server = getHttpServer(app);
    expect((await request(server).get('/auth')).status).toBe(401);
    expect((await request(server).post('/auth/withdraw')).status).toBe(401);
  });
});
