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

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let stub: http.Server;
  let stubPort: number;

  beforeAll((done) => {
    stub = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ from: 'stub' }));
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
      routing: {
        prefixes: { '/forms': 'expo-form-server', '/auth': 'expo-auth-server' },
      },
      publicPaths: ['/auth'],
    };
    app = await createTestApp({
      gatewayConfig,
      eurekaInstances: [instance({ ipAddr: '127.0.0.1', port: stubPort })],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects a protected path with no token', async () => {
    const res = await request(getHttpServer(app)).get('/forms');
    expect(res.status).toBe(401);
  });

  it('allows a protected path with a valid RS256 token', async () => {
    const token = jwt.sign({ sub: 'user-1' }, privateKeyPem, {
      algorithm: 'RS256',
      expiresIn: '5m',
    });
    const res = await request(getHttpServer(app))
      .get('/forms')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('allows a configured public path without a token', async () => {
    const res = await request(getHttpServer(app)).get('/auth/login');
    expect(res.status).toBe(200);
  });
});
