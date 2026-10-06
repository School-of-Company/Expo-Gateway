import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import {
  createTestApp,
  getHttpServer,
  instance,
  type TestAppOptions,
} from './support/gateway-test-app';
import type { GatewayConfig } from '../src/bootstrap/gateway-config.types';
import { MetricsService } from '../src/metrics/metrics.service';
import { UpstreamHealthPoller } from '../src/proxy/upstream-health.poller';

const gatewayConfig: GatewayConfig = {
  jwt: { publicKey: 'unused-in-this-test' },
  eureka: { serviceUrl: 'http://unused:8761/eureka' },
  routing: {
    prefixes: {
      '/forms': 'expo-form-server',
      '/secure': 'expo-secure-server',
    },
  },
  publicPaths: ['/forms', '/unknown', '/health'],
};

async function metricLines(app: INestApplication): Promise<string[]> {
  return (await app.get(MetricsService).render()).split('\n');
}

/** `finish`/`close` fire after the client already has the response. */
async function eventually(
  app: INestApplication,
  expected: string,
): Promise<string[]> {
  let lines: string[] = [];
  for (let i = 0; i < 100; i++) {
    lines = await metricLines(app);
    if (lines.includes(expected)) {
      return lines;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Metric line not found: ${expected}\n${lines.filter((l) => l.startsWith('gateway_')).join('\n')}`,
  );
}

const requests = (status: number, app: string, count: number) =>
  `gateway_http_requests_total{method="GET",status="${status}",app="${app}"} ${count}`;

describe('Metrics (e2e)', () => {
  let app: INestApplication;
  let stub: http.Server;
  let stubPort: number;

  beforeAll((done) => {
    stub = http.createServer((_req, res) => {
      res.writeHead(200).end('ok');
    });
    stub.listen(0, '127.0.0.1', () => {
      stubPort = (stub.address() as AddressInfo).port;
      done();
    });
  });

  afterAll((done) => {
    stub.close(done);
  });

  afterEach(async () => {
    await app.close();
  });

  const start = async (options?: Partial<TestAppOptions>) => {
    app = await createTestApp({
      gatewayConfig,
      eurekaInstances: [instance({ ipAddr: '127.0.0.1', port: stubPort })],
      ...options,
    });
  };

  it('labels proxied requests with the routed app and merges different paths into one series', async () => {
    await start();
    await request(getHttpServer(app)).get('/forms/1').expect(200);
    await request(getHttpServer(app)).get('/forms/2').expect(200);

    const lines = await eventually(app, requests(200, 'expo-form-server', 2));

    const seriesForApp = lines.filter(
      (l) =>
        l.startsWith('gateway_http_requests_total{') &&
        l.includes('expo-form-server'),
    );
    expect(seriesForApp).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('/forms/1');
  });

  it('labels a path that matches no prefix as unmatched', async () => {
    await start();
    await request(getHttpServer(app)).get('/unknown/x').expect(404);

    await eventually(app, requests(404, 'unmatched', 1));
  });

  it('still measures requests the JWT guard rejects, with the routed app label', async () => {
    await start();
    await request(getHttpServer(app)).get('/secure/x').expect(401);

    await eventually(app, requests(401, 'expo-secure-server', 1));
  });

  it('labels the gateway-owned /health as gateway', async () => {
    await start();
    await request(getHttpServer(app)).get('/health').expect(200);

    await eventually(app, requests(200, 'gateway', 1));
  });

  it('observes the upstream histogram only for proxied responses', async () => {
    await start();
    await request(getHttpServer(app)).get('/forms/1').expect(200);
    await request(getHttpServer(app)).get('/unknown/x').expect(404);
    await request(getHttpServer(app)).get('/secure/x').expect(401);

    await eventually(app, requests(401, 'expo-secure-server', 1));
    const lines = await metricLines(app);
    expect(lines).toContain(
      'gateway_upstream_duration_seconds_count{app="expo-form-server"} 1',
    );
    expect(
      lines.filter((l) =>
        l.startsWith('gateway_upstream_duration_seconds_count{'),
      ),
    ).toHaveLength(1);
  });

  it('records the per-request Eureka lookup', async () => {
    await start();
    await request(getHttpServer(app)).get('/forms/1').expect(200);

    const lines = await eventually(app, requests(200, 'expo-form-server', 1));
    expect(lines).toContain(
      'gateway_eureka_lookup_duration_seconds_count{app="expo-form-server"} 1',
    );
  });

  it('publishes the UP instance count from the poller, not from requests', async () => {
    await start();
    expect(
      (await metricLines(app)).some((l) =>
        l.startsWith('gateway_http_requests_total{'),
      ),
    ).toBe(false);

    await app.get(UpstreamHealthPoller).pollOnce();

    const lines = await metricLines(app);
    expect(lines).toContain(
      'gateway_upstream_healthy_instances{app="expo-form-server"} 1',
    );
    expect(lines).toContain(
      'gateway_upstream_healthy_instances{app="expo-secure-server"} 1',
    );
  });

  it('records 503 and a zero UP count when Eureka has no instance', async () => {
    await start({ eurekaInstances: [] });
    await request(getHttpServer(app)).get('/forms/1').expect(503);
    await app.get(UpstreamHealthPoller).pollOnce();

    await eventually(app, requests(503, 'expo-form-server', 1));
    expect(await metricLines(app)).toContain(
      'gateway_upstream_healthy_instances{app="expo-form-server"} 0',
    );
  });

  it('records 502 and a lookup failure when the Eureka lookup fails', async () => {
    await start({
      eurekaInstances: () => Promise.reject(new Error('eureka down')),
    });
    await request(getHttpServer(app)).get('/forms/1').expect(502);

    const lines = await eventually(app, requests(502, 'expo-form-server', 1));
    expect(lines).toContain(
      'gateway_eureka_lookup_failures_total{app="expo-form-server"} 1',
    );
  });

  it('shows a dead instance Eureka still lists as UP: 502s while the UP count stays', async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', resolve),
    );
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    await start({
      eurekaInstances: [instance({ ipAddr: '127.0.0.1', port: deadPort })],
    });
    await request(getHttpServer(app)).get('/forms/1').expect(502);
    await app.get(UpstreamHealthPoller).pollOnce();

    const lines = await eventually(app, requests(502, 'expo-form-server', 1));
    expect(lines).toContain(
      'gateway_upstream_healthy_instances{app="expo-form-server"} 1',
    );
  });
});
