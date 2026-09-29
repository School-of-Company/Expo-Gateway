import { All, Controller, Next, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { RouteResolverService } from './route-resolver.service';
import { LoadBalancerService } from './load-balancer.service';
import { EurekaLookupError, NoHealthyInstanceError } from './proxy.errors';

/**
 * Paths this gateway serves itself and must never proxy. The `@All('/{*splat}')`
 * catch-all matches these too, so we explicitly fall through to `next()` for
 * them regardless of Nest's controller/route registration order — Express
 * continues scanning its route stack from wherever `next()` is called, so
 * this is correct whether HealthController's own route was registered before
 * or after this catch-all.
 */
const GATEWAY_OWNED_PATHS = ['/health'];

@Controller()
export class ProxyController {
  // One long-lived proxy: http-proxy-middleware registers a `close` listener
  // on the HTTP server per instance, so creating one per request leaks
  // listeners and memory. The per-request target is handed over via this map.
  private readonly targets = new WeakMap<object, string>();

  private readonly proxy = createProxyMiddleware({
    changeOrigin: true,
    router: (req) => {
      const target = this.targets.get(req);
      if (!target) {
        throw new Error('Proxy target was not resolved for this request');
      }
      return target;
    },
    on: {
      error: (_err, _req, res) => {
        if ('writeHead' in res && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        if ('end' in res) {
          res.end(JSON.stringify({ message: 'Bad Gateway' }));
        }
      },
    },
  });

  constructor(
    private readonly routeResolver: RouteResolverService,
    private readonly loadBalancer: LoadBalancerService,
  ) {}

  // Express 5 (path-to-regexp v8) rejects the bare '*' wildcard used in
  // older examples — '/{*splat}' is the equivalent that also matches '/'.
  @All('/{*splat}')
  async handleAll(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ): Promise<void> {
    if (
      GATEWAY_OWNED_PATHS.some(
        (path) => req.path === path || req.path.startsWith(`${path}/`),
      )
    ) {
      next();
      return;
    }

    const appName = this.routeResolver.resolve(req.path);
    if (!appName) {
      res.status(404).json({ message: 'Not Found' });
      return;
    }

    let targetUrl: string;
    try {
      targetUrl = await this.loadBalancer.pickInstanceUrl(appName);
    } catch (err) {
      if (err instanceof NoHealthyInstanceError) {
        res.status(503).json({ message: 'Service Unavailable' });
        return;
      }
      if (err instanceof EurekaLookupError) {
        res.status(502).json({ message: 'Bad Gateway' });
        return;
      }
      throw err;
    }

    this.targets.set(req, targetUrl);
    await this.proxy(req, res, next);
  }
}
