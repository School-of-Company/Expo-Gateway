import * as http from 'node:http';
import type { MetricsService } from './metrics.service';

/**
 * Serves `GET /metrics` on its own listener, separate from the public one, so
 * the metrics endpoint is never reachable through the gateway's public port
 * (and never goes through JWT, rate limiting, or the catch-all proxy).
 */
export function startMetricsServer(
  metrics: MetricsService,
  port: number,
  host: string,
): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const path = req.url?.split('?')[0];
    if (req.method !== 'GET' || path !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    metrics.render().then(
      (body) => {
        res.writeHead(200, { 'Content-Type': metrics.contentType }).end(body);
      },
      () => {
        res.writeHead(500).end();
      },
    );
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
