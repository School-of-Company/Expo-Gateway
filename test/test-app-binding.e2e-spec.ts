import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import * as request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, getHttpServer } from './support/gateway-test-app';
import type { GatewayConfig } from '../src/bootstrap/gateway-config.types';

const gatewayConfig: GatewayConfig = {
  jwt: { publicKey: 'unused-in-this-test' },
  eureka: { serviceUrl: 'http://unused:8761/eureka' },
  routing: { prefixes: { '/forms': 'expo-form-server' } },
  publicPaths: ['/'],
};

// #41: supertest connects to 127.0.0.1. An app left to supertest's own
// `listen(0)` binds `::`, and on macOS another process can hold
// 127.0.0.1 on that same port and answer instead (observed: a local `codex`
// listener returning 401).
describe('createTestApp binding (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp({ gatewayConfig });
  });

  afterEach(async () => {
    await app.close();
  });

  it('listens on 127.0.0.1, the address supertest connects to', () => {
    const address = getHttpServer(app).address() as AddressInfo | null;
    expect(address).toMatchObject({ address: '127.0.0.1', family: 'IPv4' });
  });

  it('keeps another 127.0.0.1 listener off its port and answers the request itself', async () => {
    const server = getHttpServer(app);
    const { port } = server.address() as AddressInfo;
    const foreign = net.createServer();
    await expect(
      new Promise<void>((resolve, reject) => {
        foreign.once('error', reject);
        foreign.listen(port, '127.0.0.1', resolve);
      }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });

    await request(server).get('/health').expect(200);
  });
});
