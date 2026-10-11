import { All, Controller, Inject, Next, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { GatewayConfigService } from '../config/gateway-config.service';
import { stripUpstreamCorsHeaders } from '../cors/cors.policy';
import { isDocsPath } from '../docs/docs.paths';
import { MetricsService } from '../metrics/metrics.service';
import { INTERNAL_TOKEN_HEADER, isBlockedPath } from './blocked-paths';
import { isGatewayOwnedPath } from './gateway-owned-paths';
import { RouteResolverService } from './route-resolver.service';
import { LoadBalancerService } from './load-balancer.service';
import { EurekaLookupError, NoHealthyInstanceError } from './proxy.errors';
import { UPSTREAM_TIMEOUT_MS } from './upstream-timeout';

interface ProxyContext {
  target: string;
  app: string;
  startedAt: bigint;
  timedOut?: boolean;
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
      proxyReq: (proxyReq, req, res) => {
        // Set here rather than via `proxyTimeout` so the abort can be told
        // apart from an upstream reset and answered 504 instead of 502.
        proxyReq.setTimeout(this.upstreamTimeoutMs, () => {
          const context = this.contexts.get(req);
          if (context) context.timedOut = true;
          proxyReq.destroy();
        });
        // http-proxy only aborts on `aborted`, which Node no longer emits once
        // the request body has been read — a client leaving while we wait for
        // the response would otherwise keep the upstream request open.
        res.on('close', () => {
          if (!res.writableFinished) proxyReq.destroy();
        });
      },
      proxyRes: (proxyRes, req) => {
        if (this.gatewayConfig.getCorsAllowedOrigins()) {
          stripUpstreamCorsHeaders(proxyRes.headers);
        }
        const context = this.contexts.get(req);
        if (context) {
          const seconds =
            Number(process.hrtime.bigint() - context.startedAt) / 1e9;
          this.metrics.observeUpstream(context.app, seconds);
        }
      },
      error: (_err, req, res) => {
        const timedOut = this.contexts.get(req)?.timedOut === true;
        if ('writeHead' in res && !res.headersSent) {
          res.writeHead(timedOut ? 504 : 502, {
            'Content-Type': 'application/json',
          });
        }
        if ('end' in res) {
          res.end(
            JSON.stringify({
              message: timedOut ? 'Gateway Timeout' : 'Bad Gateway',
            }),
          );
        }
      },
    },
  });

  constructor(
    private readonly routeResolver: RouteResolverService,
    private readonly loadBalancer: LoadBalancerService,
    private readonly metrics: MetricsService,
    private readonly gatewayConfig: GatewayConfigService,
    @Inject(UPSTREAM_TIMEOUT_MS) private readonly upstreamTimeoutMs: number,
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
      isGatewayOwnedPath(req.path) ||
      (this.gatewayConfig.getDocs() && isDocsPath(req.path))
    ) {
      next();
      return;
    }

    const appName = isBlockedPath(req.path)
      ? undefined
      : this.routeResolver.resolve(req.path);
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

    delete req.headers[INTERNAL_TOKEN_HEADER];
    // Node already answered `100 Continue` to the client; forwarding `Expect`
    // also makes http-proxy skip the `proxyReq` hook (timeout, cancel).
    delete req.headers.expect;
    this.contexts.set(req, {
      target: targetUrl,
      app: appName,
      startedAt: process.hrtime.bigint(),
    });
    await this.proxy(req, res, next);
  }
}
