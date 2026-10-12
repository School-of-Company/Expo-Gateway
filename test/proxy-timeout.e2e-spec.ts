import * as http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import {
  createTestApp,
  getHttpServer,
  instance,
} from './support/gateway-test-app';
import type { GatewayConfig } from '../src/bootstrap/gateway-config.types';

const TIMEOUT_MS = 300;

describe('Proxy upstream timeout and client cancel (e2e)', () => {
  let app: INestApplication;
  let stub: http.Server;
  let received: http.IncomingMessage[];
  let onBodyEnd: ((req: http.IncomingMessage) => void) | undefined;
  let lookupGate: Promise<void>;
  let upstreamSockets: Socket[];

  beforeAll((done) => {
    stub = http.createServer((req, res) => {
      received.push(req);
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        onBodyEnd?.(req);
        if (req.url?.startsWith('/forms/hang')) return; // never responds
        if (req.url === '/forms/stall-body') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.write('partial'); // never ends
          return;
        }
        if (req.url === '/forms/gzip') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
          });
          res.end(gzipSync(JSON.stringify({ zipped: true })));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            contentType: req.headers['content-type'],
            body: Buffer.concat(chunks).toString(),
          }),
        );
      });
    });
    stub.on('connection', (socket: Socket) => upstreamSockets.push(socket));
    stub.listen(0, '127.0.0.1', done);
  });

  afterAll((done) => {
    stub.closeAllConnections();
    stub.close(done);
  });

  beforeEach(async () => {
    received = [];
    onBodyEnd = undefined;
    lookupGate = Promise.resolve();
    upstreamSockets = [];
    const gatewayConfig: GatewayConfig = {
      jwt: { publicKey: 'unused-in-this-test' },
      eureka: { serviceUrl: 'http://unused:8761/eureka' },
      routing: { prefixes: { '/forms': 'expo-form-server' } },
      publicPaths: ['/'],
    };
    app = await createTestApp({
      gatewayConfig,
      eurekaInstances: async () => {
        await lookupGate;
        return [
          instance({
            ipAddr: '127.0.0.1',
            port: (stub.address() as AddressInfo).port,
          }),
        ];
      },
      upstreamTimeoutMs: TIMEOUT_MS,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function listen(): Promise<number> {
    const server = getHttpServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    return (server.address() as AddressInfo).port;
  }

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  it('answers 504 when the upstream never responds, closes the upstream request and does not retry', async () => {
    const res = await request(getHttpServer(app))
      .post('/forms/hang')
      .send({ a: 1 });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ message: 'Gateway Timeout' });
    expect(received).toHaveLength(1);
    expect(received[0].socket.destroyed).toBe(true);
  }, 3000);

  it('applies the same timeout to an `Expect: 100-continue` request', async () => {
    const res = await request(getHttpServer(app))
      .post('/forms/hang')
      .set('Expect', '100-continue')
      .send({ a: 1 });

    expect(res.status).toBe(504);
    expect(received).toHaveLength(1);
    expect(received[0].headers.expect).toBeUndefined();
  }, 3000);

  it('closes the upstream request when the client cancels after sending the full body', async () => {
    const port = await listen();

    const upstreamClosed = new Promise<number>((resolve, reject) => {
      onBodyEnd = (upstreamReq) => {
        const cancelledAt = Date.now();
        upstreamReq.socket.once('close', () =>
          resolve(Date.now() - cancelledAt),
        );
        clientReq.destroy();
      };
      const clientReq = http.request({
        port,
        method: 'POST',
        path: '/forms/hang-cancel',
        headers: { 'Content-Type': 'application/json' },
      });
      clientReq.on('error', () => undefined);
      clientReq.on('response', () => reject(new Error('unexpected response')));
      clientReq.end(JSON.stringify({ a: 1 }));
    });

    // Well under TIMEOUT_MS: the cancel itself closes it, not the timeout.
    expect(await upstreamClosed).toBeLessThan(TIMEOUT_MS / 2);
    expect(received).toHaveLength(1);
  }, 3000);

  it('closes the client connection when the upstream stalls mid-body after the headers', async () => {
    const port = await listen();

    const clientClosed = new Promise<string>((resolve, reject) => {
      http
        .get({ port, path: '/forms/stall-body' }, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (body += chunk));
          res.on('close', () => resolve(body));
        })
        .on('error', reject);
    });

    expect(await clientClosed).toBe('partial');
    await sleep(50);
    expect(received[0].socket.destroyed).toBe(true);
  }, 3000);

  it('does not proxy a request whose client left during the instance lookup', async () => {
    const port = await listen();
    let releaseLookup = () => undefined as void;
    lookupGate = new Promise((resolve) => (releaseLookup = resolve));

    const clientReq = http.request({
      port,
      method: 'POST',
      path: '/forms/hang',
    });
    clientReq.on('error', () => undefined);
    clientReq.end('{}');
    await sleep(50);
    clientReq.destroy();
    await sleep(50);
    releaseLookup();
    await sleep(TIMEOUT_MS / 2);

    expect(received).toHaveLength(0);
    expect(upstreamSockets.filter((s) => !s.destroyed)).toHaveLength(0);
  }, 3000);

  it('does not report a client that stalls its upload as an upstream timeout', async () => {
    const port = await listen();
    let response: http.IncomingMessage | undefined;
    const clientReq = http.request({
      port,
      method: 'POST',
      path: '/forms/upload',
      headers: { 'Content-Length': '10' },
    });
    clientReq.on('response', (res) => (response = res));
    clientReq.on('error', () => undefined);
    clientReq.write('ab'); // 8 bytes never arrive

    await sleep(TIMEOUT_MS * 2);
    expect(response?.statusCode).toBeUndefined();

    clientReq.destroy();
    await sleep(TIMEOUT_MS / 2);
    expect(received[0].socket.destroyed).toBe(true);
  }, 3000);

  it('still passes multipart bodies through unchanged', async () => {
    const res = await request(getHttpServer(app))
      .post('/forms/upload')
      .field('name', 'expo')
      .attach('file', Buffer.from('file-content'), 'a.txt');

    expect(res.status).toBe(200);
    const body = res.body as { contentType: string; body: string };
    expect(body.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(body.body).toContain('file-content');
    expect(body.body).toContain('expo');
  });

  it('still passes compressed responses through with their encoding', async () => {
    const res = await request(getHttpServer(app)).get('/forms/gzip');

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.body).toEqual({ zipped: true });
  });
});
