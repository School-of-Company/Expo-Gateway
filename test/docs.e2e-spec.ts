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
const bearer = () =>
  `Bearer ${jwt.sign({ sub: '7' }, privateKeyPem, { algorithm: 'RS256', expiresIn: '5m' })}`;

describe('통합 API 문서 /docs (e2e)', () => {
  let stub: http.Server;
  let stubPort: number;
  const upstreamPaths: string[] = [];
  let app: INestApplication | undefined;

  beforeAll((done) => {
    stub = http.createServer((req, res) => {
      upstreamPaths.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ openapi: '3.0.1' }));
    });
    stub.listen(0, '127.0.0.1', () => {
      stubPort = (stub.address() as AddressInfo).port;
      done();
    });
  });

  afterAll((done) => {
    stub.close(done);
  });

  beforeEach(() => {
    upstreamPaths.length = 0;
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const start = async (docs?: GatewayConfig['docs']) => {
    app = await createTestApp({
      gatewayConfig: {
        jwt: { publicKey: publicKeyPem },
        eureka: { serviceUrl: 'http://unused:8761/eureka' },
        routing: { prefixes: { '/attendance': 'expo-attention-server' } },
        publicPaths: ['/health', 'GET /attendance/v3/api-docs'],
        ...(docs ? { docs } : {}),
      },
      eurekaInstances: [instance({ ipAddr: '127.0.0.1', port: stubPort })],
    });
    return getHttpServer(app);
  };

  const enabledDocs: GatewayConfig['docs'] = {
    enabled: true,
    title: 'Expo API 문서',
    services: [{ name: '참여', url: '/attendance/v3/api-docs' }],
  };

  describe('docs 설정이 없거나 꺼져 있을 때', () => {
    it.each([undefined, { enabled: false }])(
      '화면과 설정과 정적 파일이 없다: 토큰이 있으면 404, 없으면 401이고 서비스로 전달되지 않는다 (%j)',
      async (docs) => {
        const server = await start(docs);
        for (const path of [
          '/docs',
          '/docs/config.json',
          '/docs/swagger-initializer.js',
          '/docs/assets/swagger-ui.css',
        ]) {
          expect(
            (await request(server).get(path).set('Authorization', bearer()))
              .status,
          ).toBe(404);
          expect((await request(server).get(path)).status).toBe(401);
        }
        expect(upstreamPaths).toEqual([]);
      },
    );
  });

  describe('docs.enabled일 때', () => {
    it('/docs가 JWT 없이 HTML 200이다', async () => {
      const res = await request(await start(enabledDocs)).get('/docs');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('swagger-ui');
      expect(upstreamPaths).toEqual([]);
    });

    it('/docs/config.json이 설정한 서비스 목록을 돌려준다', async () => {
      const res = await request(await start(enabledDocs)).get(
        '/docs/config.json',
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        title: 'Expo API 문서',
        services: [{ name: '참여', url: '/attendance/v3/api-docs' }],
      });
    });

    it('title을 생략하면 기본 제목을 쓴다', async () => {
      const res = await request(
        await start({ enabled: true, services: enabledDocs.services }),
      ).get('/docs/config.json');
      expect((res.body as { title: string }).title).toBe('API 문서');
    });

    it('Swagger UI 정적 파일을 게이트웨이가 직접 내려준다', async () => {
      const server = await start(enabledDocs);
      const css = await request(server).get('/docs/assets/swagger-ui.css');
      expect(css.status).toBe(200);
      expect(css.headers['content-type']).toMatch(/text\/css/);
      const js = await request(server).get('/docs/assets/swagger-ui-bundle.js');
      expect(js.status).toBe(200);
      const init = await request(server).get('/docs/swagger-initializer.js');
      expect(init.status).toBe(200);
      expect(init.headers['content-type']).toMatch(/javascript/);
    });

    it('목록에 없는 파일과 경로 이탈은 열어주지 않는다', async () => {
      const server = await start(enabledDocs);
      for (const path of [
        '/docs/assets/package.json',
        '/docs/assets/swagger-ui-bundle.js.map',
        '/docs/assets/..%2Fpackage.json',
        '/docs/nothing',
      ]) {
        const res = await request(server).get(path);
        expect(res.status).toBe(404);
      }
      expect(upstreamPaths).toEqual([]);
    });

    it('/docs는 GET/HEAD만 JWT 없이 열린다', async () => {
      const server = await start(enabledDocs);
      expect((await request(server).post('/docs')).status).toBe(401);
      expect((await request(server).delete('/docs/config.json')).status).toBe(
        401,
      );
    });

    it('보호된 경로는 여전히 JWT가 필요하다', async () => {
      const server = await start(enabledDocs);
      expect((await request(server).get('/attendance/entries')).status).toBe(
        401,
      );
      expect(
        (await request(server).get('/attendance/v3/api-docs/other')).status,
      ).toBe(401);
    });

    it('서비스의 OpenAPI 경로는 publicPaths 항목이 있을 때만 열리고 그대로 전달된다', async () => {
      const server = await start(enabledDocs);
      const res = await request(server).get('/attendance/v3/api-docs');
      expect(res.status).toBe(200);
      expect(upstreamPaths).toEqual(['GET /attendance/v3/api-docs']);
    });

    it('등록되지 않은 경로는 이전처럼 401(토큰 없음)/404(토큰 있음)이고 /health는 그대로다', async () => {
      const server = await start(enabledDocs);
      expect((await request(server).get('/swagger-ui.html')).status).toBe(401);
      expect(
        (
          await request(server)
            .get('/swagger-ui.html')
            .set('Authorization', bearer())
        ).status,
      ).toBe(404);
      expect((await request(server).get('/health')).status).toBe(200);
    });
  });
});
