import { All, Controller, Next, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { MetricsService } from '../metrics/metrics.service';
import { isGatewayOwnedPath } from './gateway-owned-paths';
import { RouteResolverService } from './route-resolver.service';
import { LoadBalancerService } from './load-balancer.service';
import { EurekaLookupError, NoHealthyInstanceError } from './proxy.errors';

interface ProxyContext {
  target: string;
  app: string;
  startedAt: bigint;
}

@Controller()
export class ProxyController {
  // One long-lived proxy: http-proxy-middleware registers a `close` listener
  // on the HTTP server per instance, so creating one per request leaks
  // listeners and memory. Per-request state is handed over via this map.
  private readonly contexts = new WeakMap<object, ProxyContext>();

  private readonly proxy = createProxyMiddleware({
    changeOrigin: true,
    router: (req) => {
      const context = this.contexts.get(req);
      if (!context) {
        throw new Error('Proxy target was not resolved for this request');
      }
      return context.target;
    },
    on: {
      proxyRes: (_proxyRes, req) => {
        const context = this.contexts.get(req);
        if (context) {
          const seconds =
            Number(process.hrtime.bigint() - context.startedAt) / 1e9;
          this.metrics.observeUpstream(context.app, seconds);
        }
      },
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
    private readonly metrics: MetricsService,
  ) {}

  // Express 5 (path-to-regexp v8) rejects the bare '*' wildcard used in
  // older examples — '/{*splat}' is the equivalent that also matches '/'.
  @All('/{*splat}')
  async handleAll(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ): Promise<void> {
    if (isGatewayOwnedPath(req.path)) {
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

    this.contexts.set(req, {
      target: targetUrl,
      app: appName,
      startedAt: process.hrtime.bigint(),
    });
    await this.proxy(req, res, next);
  }
}
