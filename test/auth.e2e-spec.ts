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
    stub = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          from: 'stub',
          xUserId: req.headers['x-user-id'] ?? null,
          xUserRole: req.headers['x-user-role'] ?? null,
          authorization: req.headers['authorization'] ?? null,
        }),
      );
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

  it.each([
    ['expired', -900, 0, 401],
    ['future iat', 60, 900, 401],
    ['over 15 minutes', -60, 841, 401],
    ['exactly 15 minutes', -60, 840, 200],
    ['missing iat', undefined, 900, 401],
    ['missing exp', 0, undefined, 401],
    ['missing both claims', undefined, undefined, 401],
    ['tampered', -60, 840, 401],
  ])('handles a %s token over HTTP', async (name, iat, exp, status) => {
    const now = Math.floor(Date.now() / 1000);
    let token = jwt.sign(
      {
        sub: 'user-1',
        ...(iat === undefined ? {} : { iat: now + iat }),
        ...(exp === undefined ? {} : { exp: now + exp }),
      },
      privateKeyPem,
      { algorithm: 'RS256', noTimestamp: iat === undefined },
    );
    if (name === 'tampered') {
      const index = token.length - 10;
      token =
        token.slice(0, index) +
        (token[index] === 'a' ? 'b' : 'a') +
        token.slice(index + 1);
    }
    const res = await request(getHttpServer(app))
      .get('/forms')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(status);
  });
  describe('X-User-Id forwarding', () => {
    type Echo = { xUserId: string | null; authorization: string | null };
    const signToken = () =>
      jwt.sign({ sub: 'user-1' }, privateKeyPem, {
        algorithm: 'RS256',
        expiresIn: '5m',
      });

    it('forwards the token subject as x-user-id and keeps Authorization', async () => {
      const token = signToken();
      const res = await request(getHttpServer(app))
        .get('/forms')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body as Echo).toEqual(
        expect.objectContaining({
          xUserId: 'user-1',
          authorization: `Bearer ${token}`,
        }),
      );
    });

    it('replaces a spoofed x-user-id with the token subject', async () => {
      const res = await request(getHttpServer(app))
        .get('/forms')
        .set('Authorization', `Bearer ${signToken()}`)
        .set('X-User-Id', 'attacker');
      expect((res.body as Echo).xUserId).toBe('user-1');
    });

    it('does not forward a spoofed x-user-id on a public path', async () => {
      const res = await request(getHttpServer(app))
        .get('/auth/login')
        .set('X-User-Id', 'attacker');
      expect(res.status).toBe(200);
      expect((res.body as Echo).xUserId).toBeNull();
    });
  });

  describe('X-User-Role forwarding', () => {
    type Echo = { xUserRole: string | null };
    const signToken = (claims: Record<string, unknown>) =>
      jwt.sign(claims, privateKeyPem, { algorithm: 'RS256', expiresIn: '5m' });

    it('forwards the token role claim as x-user-role', async () => {
      const res = await request(getHttpServer(app))
        .get('/forms')
        .set(
          'Authorization',
          `Bearer ${signToken({ sub: 'user-1', role: 'ROLE_ADMIN' })}`,
        );
      expect(res.status).toBe(200);
      expect((res.body as Echo).xUserRole).toBe('ROLE_ADMIN');
    });

    it('replaces a spoofed x-user-role with the token role', async () => {
      const res = await request(getHttpServer(app))
        .get('/forms')
        .set(
          'Authorization',
          `Bearer ${signToken({ sub: 'user-1', role: 'ROLE_STANDARD' })}`,
        )
        .set('X-User-Role', 'ROLE_ADMIN');
      expect((res.body as Echo).xUserRole).toBe('ROLE_STANDARD');
    });

    it('drops a spoofed x-user-role when the token has no role', async () => {
      const res = await request(getHttpServer(app))
        .get('/forms')
        .set('Authorization', `Bearer ${signToken({ sub: 'user-1' })}`)
        .set('X-User-Role', 'ROLE_ADMIN');
      expect(res.status).toBe(200);
      expect((res.body as Echo).xUserRole).toBeNull();
    });

    it('does not forward a spoofed x-user-role on a public path', async () => {
      const res = await request(getHttpServer(app))
        .get('/auth/login')
        .set('X-User-Role', 'ROLE_ADMIN');
      expect(res.status).toBe(200);
      expect((res.body as Echo).xUserRole).toBeNull();
    });
  });
});
