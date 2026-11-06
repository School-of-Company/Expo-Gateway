import * as http from 'node:http';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { EurekaInstance } from '@school-of-company/nestjs-eureka';
import {
  createTestApp,
  getHttpServer,
  instance,
} from './support/gateway-test-app';
import type { GatewayConfig } from '../src/bootstrap/gateway-config.types';
import { MetricsService } from '../src/metrics/metrics.service';

const gatewayConfig: GatewayConfig = {
  jwt: { publicKey: 'unused-in-this-test' },
  eureka: { serviceUrl: 'http://unused:8761/eureka' },
  routing: { prefixes: { '/forms': 'expo-form-server' } },
  publicPaths: ['/'],
};

/** A port nothing listens on: bound, then closed. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

describe('Proxy connect failures (e2e)', () => {
  let app: INestApplication;
  let live: http.Server;
  let livePort: number;
  let hits: number;

  beforeAll(async () => {
    live = http.createServer((req, res) => {
      hits++;
      req.resume();
      req.on('end', () => res.end('ok'));
    });
    await new Promise<void>((r) => live.listen(0, '127.0.0.1', r));
    livePort = (live.address() as AddressInfo).port;
  });

  afterAll((done) => {
    live.closeAllConnections();
    live.close(done);
  });

  beforeEach(() => {
    hits = 0;
  });

  afterEach(async () => {
    await app.close();
  });

  const start = async (instances: EurekaInstance[], connectTimeoutMs = 300) => {
    app = await createTestApp({
      gatewayConfig,
      eurekaInstances: instances,
      upstreamConnectTimeoutMs: connectTimeoutMs,
    });
  };
  const metricsText = () => app.get(MetricsService).render();

  it('answers 502 at once when the only instance refuses the connection', async () => {
    await start([instance({ port: await closedPort() })]);

    const res = await request(getHttpServer(app)).get('/forms/x');

    expect(res.status).toBe(502);
    expect(await metricsText()).toContain(
      'gateway_upstream_connect_failures_total{app="expo-form-server",reason="refused"} 1',
    );
  });

  it('retries a bodiless request on the other instance and then skips the dead one', async () => {
    const dead = await closedPort();
    await start([instance({ port: dead }), instance({ port: livePort })]);

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await request(getHttpServer(app)).get('/forms/x')).status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
    expect(hits).toBe(6);
    const text = await metricsText();
    // One failure: after it the dead instance is out of the round-robin.
    expect(text).toContain(
      'gateway_upstream_connect_failures_total{app="expo-form-server",reason="refused"} 1',
    );
    expect(text).toContain(
      'gateway_upstream_quarantines_total{app="expo-form-server"} 1',
    );
    expect(text).toContain(
      'gateway_upstream_retries_total{app="expo-form-server"} 1',
    );
  });

  it('does not retry a request with a body (it was consumed by the failed attempt)', async () => {
    const dead = await closedPort();
    await start([instance({ port: dead }), instance({ port: livePort })]);

    // Round-robin starts at the dead instance.
    const res = await request(getHttpServer(app))
      .post('/forms/x')
      .send({ a: 1 });

    expect(res.status).toBe(502);
    expect(hits).toBe(0);
  });

  it('gives up after the connect timeout on a host that never answers the SYN, then retries elsewhere', async () => {
    // A vanished host drops SYNs; real networks differ (some answer
    // EHOSTUNREACH at once), so the stalled connect is simulated: every agent
    // (global or a custom keep-alive one) builds sockets through this method.
    const blackhole = await closedPort();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with `this` below
    const original = http.Agent.prototype.createConnection;
    const spy = jest
      .spyOn(http.Agent.prototype, 'createConnection')
      .mockImplementation(function (
        this: http.Agent,
        options: net.NetConnectOpts,
        cb?: (err: Error | null, socket: net.Socket) => void,
      ) {
        // http-proxy passes the port as a string.
        if (Number((options as net.TcpNetConnectOpts).port) === blackhole) {
          const socket = new net.Socket();
          (socket as { connecting: boolean }).connecting = true; // never connects
          return socket;
        }
        return original.call(this, options, cb) as net.Socket;
      });
    try {
      await start([instance({ port: blackhole })], 300);
      const startedAt = Date.now();
      const single = await request(getHttpServer(app)).get('/forms/x');
      expect(single.status).toBe(502);
      expect(Date.now() - startedAt).toBeLessThan(1_500);
      expect(await metricsText()).toContain(
        'gateway_upstream_connect_failures_total{app="expo-form-server",reason="timeout"} 1',
      );
      await app.close();

      await start(
        [instance({ port: blackhole }), instance({ port: livePort })],
        300,
      );
      const retried = await request(getHttpServer(app)).get('/forms/x');
      expect(retried.status).toBe(200);
      expect(hits).toBe(1);
    } finally {
      spy.mockRestore();
    }
  }, 5000);
});
