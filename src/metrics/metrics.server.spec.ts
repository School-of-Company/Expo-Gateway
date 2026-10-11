import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MetricsService } from './metrics.service';
import { startMetricsServer } from './metrics.server';

describe('startMetricsServer', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve(),
    );
    server = undefined;
  });

  async function start(metrics = new MetricsService()) {
    server = await startMetricsServer(metrics, 0, '127.0.0.1');
    const { port } = server.address() as AddressInfo;
    return { metrics, base: `http://127.0.0.1:${port}` };
  }

  it('serves the registry on GET /metrics', async () => {
    const { metrics, base } = await start();
    metrics.recordRequest('GET', 200, 'a', 0.01);

    const res = await fetch(`${base}/metrics`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('gateway_http_requests_total');
  });

  it('ignores a query string', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/metrics?x=1`)).status).toBe(200);
  });

  it('404s any other path or method', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/health`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`, { method: 'POST' })).status).toBe(
      404,
    );
  });

  it('responds 500 when rendering fails', async () => {
    const metrics = new MetricsService();
    jest.spyOn(metrics, 'render').mockRejectedValue(new Error('boom'));
    const { base } = await start(metrics);

    expect((await fetch(`${base}/metrics`)).status).toBe(500);
  });

  it('rejects when the port is already in use', async () => {
    const { base } = await start();
    const port = Number(new URL(base).port);

    await expect(
      startMetricsServer(new MetricsService(), port, '127.0.0.1'),
    ).rejects.toThrow(/EADDRINUSE/);
  });
});
