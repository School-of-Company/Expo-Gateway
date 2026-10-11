import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { parseGatewayConfig } from '../src/bootstrap/gateway-config.validate';
import {
  createTestApp,
  getHttpServer,
  instance,
} from './support/gateway-test-app';

/**
 * Participant browser flows (Gateway #25 User phone auth, #29 Application)
 * through the real HTTP stack: dynamic method-qualified public paths, cookie
 * and CSRF header pass-through, credentialed CORS with an exact origin, the
 * Origin check on writes, `/internal/**` blocking and upstream status codes.
 */
const FRONT = 'https://expo.example.com';
const FOREIGN = 'https://evil.example.net';

const PUBLIC_PATHS = [
  'POST /participant-auth/code',
  'POST /participant-auth/verify',
  'GET /participant-auth/session',
  'DELETE /participant-auth/session',
  'POST /application/{expoId}',
  'POST /application/pre-standard/{expoId}',
  'POST /application/field/{expoId}',
  'POST /application/field/standard/{expoId}',
  'GET /application/expos/{expoId}/preregister-sessions/{sessionId}/capacity',
  'GET /application/program-session-csrf',
  'POST /application/expos/{expoId}/program-sessions/{programType:STANDARD|TRAINING}/{programId}/applications',
  'GET /application/expos/{expoId}/my-applications',
  'POST /application/expos/{expoId}/my-applications/{type:PREREGISTER|STANDARD|TRAINING}/{applicationId}/cancellation',
];

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
}

describe('Participant browser flows (e2e)', () => {
  let upstream: http.Server;
  let port: number;
  let seen: Seen[];
  let reply: (res: http.ServerResponse) => void;
  let app: INestApplication;

  const defaultReply = (res: http.ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  };

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      reply(res);
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );
    port = (upstream.address() as AddressInfo).port;
  });

  afterAll((done) => {
    upstream.close(done);
  });

  async function start(withCors = true) {
    app = await createTestApp({
      gatewayConfig: parseGatewayConfig({
        jwt: {
          publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
        },
        eureka: { serviceUrl: 'http://unused:8761/eureka' },
        routing: {
          prefixes: {
            '/participant-auth': 'expo-user-server',
            '/application': 'expo-application-server',
            // A misconfigured route must still never expose internal APIs.
            '/internal': 'expo-user-server',
          },
        },
        publicPaths: PUBLIC_PATHS,
        rateLimit: {
          ttlSeconds: 60,
          limit: 1000,
          participantAuthCode: { ttlSeconds: 600, limit: 2 },
        },
        ...(withCors ? { cors: { allowedOrigins: [FRONT] } } : {}),
      }),
      eurekaInstances: [instance({ port })],
    });
  }

  beforeEach(() => {
    seen = [];
    reply = defaultReply;
  });

  afterEach(async () => {
    await app.close();
  });

  describe('with cors.allowedOrigins', () => {
    beforeEach(() => start());

    it('answers an allowed preflight itself with the exact origin', async () => {
      const res = await request(getHttpServer(app))
        .options(
          '/application/expos/1/program-sessions/TRAINING/2/applications',
        )
        .set('Origin', FRONT)
        .set('Access-Control-Request-Method', 'POST')
        .set(
          'Access-Control-Request-Headers',
          'content-type,x-xsrf-token,idempotency-key',
        );

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(FRONT);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-methods']).toContain('DELETE');
      for (const header of [
        'X-CSRF-TOKEN',
        'X-XSRF-TOKEN',
        'Idempotency-Key',
      ]) {
        expect(res.headers['access-control-allow-headers']).toContain(header);
      }
      expect(res.headers['vary']).toContain('Origin');
      expect(seen).toHaveLength(0);
    });

    it('refuses a foreign preflight without CORS headers', async () => {
      const res = await request(getHttpServer(app))
        .options('/participant-auth/session')
        .set('Origin', FOREIGN)
        .set('Access-Control-Request-Method', 'DELETE');

      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(seen).toHaveLength(0);
    });

    it('passes Set-Cookie through verbatim and owns the CORS headers', async () => {
      const cookies = [
        'PARTICIPANT_SESSION=s1; Max-Age=1800; Path=/; Secure; HttpOnly; SameSite=Lax',
        'JSESSIONID=j1; Path=/; HttpOnly',
      ];
      reply = (res) => {
        res.writeHead(200, {
          'Set-Cookie': cookies,
          'Access-Control-Allow-Origin': '*',
          Vary: 'Accept-Encoding',
        });
        res.end('{"expoId":"1"}');
      };

      const res = await request(getHttpServer(app))
        .post('/participant-auth/verify')
        .set('Origin', FRONT)
        .send({ expoId: '1' });

      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toEqual(cookies);
      expect(res.headers['access-control-allow-origin']).toBe(FRONT);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['vary']).toBe('Accept-Encoding, Origin');
    });

    it('forwards session cookies and CSRF / idempotency headers, never internal or identity ones', async () => {
      const res = await request(getHttpServer(app))
        .post('/application/expos/7/my-applications/STANDARD/42/cancellation')
        .set('Origin', FRONT)
        .set('Cookie', 'PARTICIPANT_SESSION=s1; JSESSIONID=j1; XSRF-TOKEN=x1')
        .set('X-CSRF-TOKEN', 'csrf-1')
        .set('X-XSRF-TOKEN', 'x1')
        .set('Idempotency-Key', 'idem-1')
        .set('X-Internal-Token', 'guess')
        .set('X-User-Id', '1')
        .set('X-User-Role', 'ADMIN');

      expect(res.status).toBe(200);
      const [upstreamReq] = seen;
      expect(upstreamReq.url).toBe(
        '/application/expos/7/my-applications/STANDARD/42/cancellation',
      );
      expect(upstreamReq.headers.cookie).toBe(
        'PARTICIPANT_SESSION=s1; JSESSIONID=j1; XSRF-TOKEN=x1',
      );
      expect(upstreamReq.headers['x-csrf-token']).toBe('csrf-1');
      expect(upstreamReq.headers['x-xsrf-token']).toBe('x1');
      expect(upstreamReq.headers['idempotency-key']).toBe('idem-1');
      expect(upstreamReq.headers['x-internal-token']).toBeUndefined();
      expect(upstreamReq.headers['x-user-id']).toBeUndefined();
      expect(upstreamReq.headers['x-user-role']).toBeUndefined();
    });

    it('exposes the X-CSRF-TOKEN response header to the allowed origin', async () => {
      reply = (res) => {
        res.writeHead(200, { 'X-CSRF-TOKEN': 'csrf-1' });
        res.end('[]');
      };
      const res = await request(getHttpServer(app))
        .get('/application/expos/7/my-applications')
        .set('Origin', FRONT)
        .set('Cookie', 'PARTICIPANT_SESSION=s1');

      expect(res.headers['x-csrf-token']).toBe('csrf-1');
      expect(res.headers['access-control-expose-headers']).toContain(
        'X-CSRF-TOKEN',
      );
      expect(seen[0].headers.cookie).toBe('PARTICIPANT_SESSION=s1');
    });

    it.each([
      ['POST', '/application/7'],
      ['DELETE', '/participant-auth/session'],
      ['POST', '/application/expos/7/program-sessions/TRAINING/2/applications'],
    ])(
      'rejects %s %s from a foreign origin before it reaches a backend',
      async (method, path) => {
        const res = await request(getHttpServer(app))
          [method === 'POST' ? 'post' : 'delete'](path)
          .set('Origin', FOREIGN)
          .set('Cookie', 'PARTICIPANT_SESSION=s1');

        expect(res.status).toBe(403);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
        expect(seen).toHaveLength(0);
      },
    );

    it('lets a foreign-origin GET through without CORS headers (the browser keeps the body)', async () => {
      const res = await request(getHttpServer(app))
        .get('/participant-auth/session?expoId=7')
        .set('Origin', FOREIGN);

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(seen[0].url).toBe('/participant-auth/session?expoId=7');
    });

    it('lets a write without Origin through (server-side BFF, not a browser)', async () => {
      const res = await request(getHttpServer(app))
        .delete('/participant-auth/session')
        .set('Cookie', 'PARTICIPANT_SESSION=s1');

      expect(res.status).toBe(200);
      expect(seen).toHaveLength(1);
    });

    it.each([
      [401, '{"status":401,"code":"SESSION_EXPIRED"}'],
      [403, '{"status":403,"code":"CSRF_REQUIRED"}'],
      [409, '{"status":409,"code":"APPLICATION_CONFLICT"}'],
      [429, '{"status":429}'],
      [503, '{"status":503,"code":"SUPPLIER_UNAVAILABLE"}'],
    ])('keeps upstream status %d and its body', async (status, body) => {
      reply = (res) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body);
      };
      const res = await request(getHttpServer(app))
        .post('/application/expos/7/program-sessions/TRAINING/2/applications')
        .set('Origin', FRONT)
        .set('Idempotency-Key', 'idem-1');

      expect(res.status).toBe(status);
      expect(res.text).toBe(body);
      expect(res.headers['access-control-allow-origin']).toBe(FRONT);
    });

    it.each([
      '/internal/participant-sessions/resolve',
      '/participant-auth/..%2finternal/participant-sessions/resolve',
      '/application/%2e%2e/internal/expos/1/purge',
    ])('never forwards %s, even with a valid JWT', async (path) => {
      const token = jwt.sign(
        { sub: '1', role: 'ADMIN' },
        privateKey.export({ type: 'pkcs8', format: 'pem' }),
        { algorithm: 'RS256', expiresIn: '5m' },
      );
      const res = await request(getHttpServer(app))
        .post(path)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Internal-Token', 'guess');

      expect(res.status).toBe(404);
      expect(seen).toHaveLength(0);
    });

    it('opens only the listed methods and shapes of the dynamic public paths', async () => {
      const server = getHttpServer(app);
      expect((await request(server).post('/application/7')).status).toBe(200);
      expect((await request(server).get('/application/7')).status).toBe(401);
      expect((await request(server).post('/application/admin')).status).toBe(
        401,
      );
      expect(
        (await request(server).get('/application/expos/7/my-applications/x'))
          .status,
      ).toBe(401);
      expect(
        (await request(server).delete('/application/expos/7/my-applications'))
          .status,
      ).toBe(401);
      expect((await request(server).get('/participant-auth/code')).status).toBe(
        401,
      );
      expect(seen).toHaveLength(1);
    });

    it('budgets POST /participant-auth/code per IP without touching the session check', async () => {
      const server = getHttpServer(app);
      const code = () =>
        request(server).post('/participant-auth/code').set('Origin', FRONT);

      expect((await code()).status).toBe(200);
      expect((await code()).status).toBe(200);
      const limited = await code();
      expect(limited.status).toBe(429);
      expect(limited.headers['retry-after-participantauthcode']).toBeDefined();
      for (const variant of [
        '/participant-auth/%63ode',
        '/participant-auth/code;x',
      ]) {
        expect((await request(server).post(variant)).status).toBe(429);
      }
      expect(
        (await request(server).get('/participant-auth/session?expoId=7'))
          .status,
      ).toBe(200);
      expect(seen).toHaveLength(3);
    });
  });

  describe('without a cors section', () => {
    beforeEach(() => start(false));

    it('keeps the previous behaviour: no CORS headers, no Origin check', async () => {
      const res = await request(getHttpServer(app))
        .post('/application/7')
        .set('Origin', FOREIGN);

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(seen).toHaveLength(1);
    });
  });
});
