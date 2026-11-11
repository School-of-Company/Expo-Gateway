import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createUpstreamAgent,
  UPSTREAM_IDLE_SOCKET_TIMEOUT_MS,
  UPSTREAM_MAX_SOCKETS,
} from './upstream-agent';

describe('createUpstreamAgent', () => {
  let server: Server;
  let port: number;
  let connections: number;

  beforeEach(async () => {
    connections = 0;
    server = createServer((_req, res) => res.end('ok'));
    server.on('connection', () => connections++);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const get = (agent: ReturnType<typeof createUpstreamAgent>) =>
    new Promise<void>((resolve, reject) => {
      request({ host: '127.0.0.1', port, agent }, (res) => {
        res.resume().on('end', resolve);
      })
        .on('error', reject)
        .end();
    });

  it('reuses one connection for sequential requests', async () => {
    const agent = createUpstreamAgent();
    await get(agent);
    await get(agent);
    await get(agent);
    agent.destroy();

    expect(connections).toBe(1);
  });

  it('drops idle sockets before the backend keep-alive timeout (Node: 5s)', async () => {
    const agent = createUpstreamAgent();
    await get(agent);
    const [idle] = Object.values(agent.freeSockets).flat();

    expect(idle?.timeout).toBe(UPSTREAM_IDLE_SOCKET_TIMEOUT_MS);
    expect(UPSTREAM_IDLE_SOCKET_TIMEOUT_MS).toBeLessThan(5_000);
    expect(agent.maxSockets).toBe(UPSTREAM_MAX_SOCKETS);
    agent.destroy();
  });

  it('does not return a destroyed request socket to the pool', async () => {
    const agent = createUpstreamAgent();
    await get(agent);
    const req = request({ host: '127.0.0.1', port, agent });
    req.on('error', () => undefined);
    await new Promise<void>((resolve) => req.on('socket', () => resolve()));
    req.destroy();
    await new Promise((resolve) => setImmediate(resolve));

    expect(Object.values(agent.freeSockets).flat()).toHaveLength(0);
    await get(agent);
    expect(connections).toBe(2);
    agent.destroy();
  });
});
