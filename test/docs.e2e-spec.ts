import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
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
  const upstreamAuthorization: Array<string | undefined> = [];
  let app: INestApplication | undefined;

  beforeAll((done) => {
    stub = http.createServer((req, res) => {
      upstreamPaths.push(`${req.method} ${req.url}`);
      upstreamAuthorization.push(req.headers['authorization']);
      if (req.headers['accept-encoding']?.includes('gzip')) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
        });
        res.end(gzipSync(JSON.stringify({ openapi: '3.0.1' })));
        return;
      }
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
    upstreamAuthorization.length = 0;
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
        tryItOut: true,
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

    it('Try it out 요청은 문서의 servers가 백엔드 주소여도 게이트웨이로 간다', async () => {
      const server = await start(enabledDocs);
      const { text } = await request(server).get(
        '/docs/swagger-initializer.js',
      );
      let options:
        | {
            requestInterceptor: (r: { url: string; loadSpec?: boolean }) => {
              url: string;
            };
          }
        | undefined;
      const window = {
        location: {
          href: 'https://gw.example/docs',
          origin: 'https://gw.example',
        },
        addEventListener: (_event: string, listener: () => void) => listener(),
      };
      const fetchConfig = () =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              title: 't',
              services: [{ name: 'a', url: '/a' }],
            }),
        });
      const SwaggerUIBundle = Object.assign(
        (o: typeof options) => (options = o),
        { presets: {} },
      );
      // 게이트웨이가 내려주는 고정 스크립트를 브라우저 대신 격리된 컨텍스트에서 실행한다.
      runInNewContext(text, {
        window,
        document: { getElementById: () => ({}) },
        fetch: fetchConfig,
        SwaggerUIBundle,
        SwaggerUIStandalonePreset: {},
        URL,
      });
      await new Promise((resolve) => setImmediate(resolve));

      const pin = (url: string, loadSpec?: boolean) =>
        options!.requestInterceptor({ url, loadSpec }).url;
      // 문서와 외부 $ref를 불러오는 요청(loadSpec)은 바꾸지 않는다.
      expect(pin('https://schemas.example/common.json', true)).toBe(
        'https://schemas.example/common.json',
      );
      expect(pin('http://10.0.0.5:8081/attendance/1?x=1')).toBe(
        'https://gw.example/attendance/1?x=1',
      );
      expect(pin('https://gw.example/expo/1')).toBe(
        'https://gw.example/expo/1',
      );
      expect(pin('http://10.0.0.5:8081/forms/a%20b')).toBe(
        'https://gw.example/forms/a%20b',
      );
      expect(pin('/attendance/v3/api-docs')).toBe(
        'https://gw.example/attendance/v3/api-docs',
      );
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

    it('서비스 OpenAPI 응답의 Content-Type과 gzip 본문을 바꾸지 않고 전달한다', async () => {
      const server = await start(enabledDocs);
      const res = await request(server)
        .get('/attendance/v3/api-docs')
        .set('Accept-Encoding', 'gzip');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/json');
      expect(res.headers['content-encoding']).toBe('gzip');
      // supertest가 gzip을 풀어 파싱했으므로 압축된 본문이 온전히 전달된 것이다.
      expect(res.body).toEqual({ openapi: '3.0.1' });
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

  describe('docs.basicAuth를 설정했을 때(운영)', () => {
    const basicAuth = {
      username: 'docs-reader',
      password: 'correct-horse-battery',
    };
    const protectedDocs: GatewayConfig['docs'] = {
      ...enabledDocs,
      basicAuth,
      requireAuth: true,
      tryItOut: false,
    };
    const basic = (user: string, password: string) =>
      `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
    const valid = () => basic(basicAuth.username, basicAuth.password);

    it('자격 증명이 없으면 화면·설정·서비스 문서 모두 401이고 기본 인증창을 요청하며 서비스로 가지 않는다', async () => {
      const server = await start(protectedDocs);
      for (const path of [
        '/docs',
        '/docs/config.json',
        '/docs/swagger-initializer.js',
        '/docs/assets/swagger-ui.css',
        '/attendance/v3/api-docs',
      ]) {
        const res = await request(server).get(path);
        expect(res.status).toBe(401);
        expect(res.headers['www-authenticate']).toBe(
          'Basic realm="docs", charset="UTF-8"',
        );
        expect(res.text).not.toContain('swagger-ui');
        expect(res.text).not.toContain(basicAuth.password);
      }
      expect(upstreamPaths).toEqual([]);
    });

    it('틀린 사용자 이름이나 비밀번호와 JWT는 401이다', async () => {
      const server = await start(protectedDocs);
      for (const header of [
        basic(basicAuth.username, 'wrong-password-123'),
        basic('someone-else', basicAuth.password),
        basic('', ''),
        'Basic !!!not-base64!!!',
        'Basic ' + Buffer.from('no-colon').toString('base64'),
        bearer(),
      ]) {
        expect(
          (await request(server).get('/docs').set('Authorization', header))
            .status,
        ).toBe(401);
      }
    });

    it('올바른 자격 증명이면 화면과 설정과 서비스 문서가 열린다', async () => {
      const server = await start(protectedDocs);
      const page = await request(server)
        .get('/docs')
        .set('Authorization', valid());
      expect(page.status).toBe(200);
      expect(page.text).toContain('swagger-ui');
      const config = await request(server)
        .get('/docs/config.json')
        .set('Authorization', valid());
      expect(config.status).toBe(200);
      expect((config.body as { tryItOut: boolean }).tryItOut).toBe(false);
      const spec = await request(server)
        .get('/attendance/v3/api-docs')
        .set('Authorization', valid());
      expect(spec.status).toBe(200);
      expect(upstreamPaths).toEqual(['GET /attendance/v3/api-docs']);
    });

    it('서비스로 전달되는 문서 요청에는 문서 자격 증명을 싣지 않는다', async () => {
      const server = await start(protectedDocs);
      await request(server)
        .get('/attendance/v3/api-docs')
        .set('Authorization', valid());
      expect(upstreamAuthorization).toEqual([undefined]);
    });

    it('publicPaths에 서비스 문서가 있어도 자격 증명 없이는 열리지 않는다', async () => {
      const server = await start(protectedDocs);
      // start()의 publicPaths에는 GET /attendance/v3/api-docs 가 들어 있다
      expect(
        (await request(server).get('/attendance/v3/api-docs')).status,
      ).toBe(401);
    });

    it('문서 자격 증명으로는 다른 API를 쓸 수 없고 쓰기 요청도 JWT가 필요하다', async () => {
      const server = await start(protectedDocs);
      expect(
        (
          await request(server)
            .get('/attendance/entries')
            .set('Authorization', valid())
        ).status,
      ).toBe(401);
      expect(
        (await request(server).post('/docs').set('Authorization', valid()))
          .status,
      ).toBe(401);
      expect(upstreamPaths).toEqual([]);
    });

    it('JWT가 있어도 문서 JSON은 문서 자격 증명이 필요하다', async () => {
      const server = await start(protectedDocs);
      expect(
        (
          await request(server)
            .get('/attendance/v3/api-docs')
            .set('Authorization', bearer())
        ).status,
      ).toBe(401);
    });
  });
});
