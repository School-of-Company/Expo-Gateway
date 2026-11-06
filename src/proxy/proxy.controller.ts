import { All, Controller, Inject, Next, Req, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ClientRequest } from 'node:http';
import { GatewayConfigService } from '../config/gateway-config.service';
import { stripUpstreamCorsHeaders } from '../cors/cors.policy';
import { isDocsPath } from '../docs/docs.paths';
import { MetricsService } from '../metrics/metrics.service';
import { INTERNAL_TOKEN_HEADER, isBlockedPath } from './blocked-paths';
import { BFF_TOKEN_HEADER } from './client-ip';
import { connectFailureReason } from './connect-failure';
import { UPSTREAM_CONNECT_TIMEOUT_MS } from './upstream-timeout';
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
  // Per attempt: reset when the request is retried on another instance.
  connected: boolean;
  connectTimedOut: boolean;
  retried: boolean;
  next: NextFunction;
}

/**
 * Only a request without a body is retried: http-proxy pipes the incoming
 * stream into the upstream request, so a body is already consumed by the
 * failed attempt and cannot be sent again without buffering every upload.
 */
function hasNoBody(req: Request): boolean {
  const length = req.headers['content-length'];
  return (
    req.headers['transfer-encoding'] === undefined &&
    (length === undefined || length === '0')
  );
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
        this.armConnectTimeout(proxyReq, req);
        // Set here rather than via `proxyTimeout` so the abort can be told
        // apart from an upstream reset and answered 504 instead of 502.
        // Armed only once the client body is in: a client stalling its own
        // upload is not an upstream timeout (Node's requestTimeout covers it).
        const armTimeout = () =>
          proxyReq.setTimeout(this.upstreamTimeoutMs, () => {
            if (res.headersSent) {
              // Too late for a 504, and pipe() would never end `res`.
              res.destroy();
              return;
            }
            const context = this.contexts.get(req);
            if (context) context.timedOut = true;
            proxyReq.destroy();
          });
        if (req.readableEnded) armTimeout();
        else req.once('end', armTimeout);
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
      error: (err, req, res) => {
        const context = this.contexts.get(req);
        const reason = context && connectFailureReason(err, context);
        if (context && reason) {
          this.loadBalancer.reportConnectFailure(
            context.app,
            context.target,
            reason,
          );
          // The instance never got a byte, so trying another one cannot run
          // the request twice — whatever the method.
          if (
            !context.retried &&
            'headersSent' in res &&
            !res.headersSent &&
            hasNoBody(req as Request)
          ) {
            context.retried = true;
            void this.retryElsewhere(req as Request, res as Response, context);
            return;
          }
        }
        // A connection that could not be opened (refused, unreachable, or
        // the connect timeout) stays 502 like before, not 504: nothing was
        // waited on upstream, and GatewayUpstream502Rate keeps covering a
        // crashed process and a vanished host alike. 503 stays reserved for
        // "Eureka has no instance".
        const timedOut = context?.timedOut === true;
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
    @Inject(UPSTREAM_CONNECT_TIMEOUT_MS)
    private readonly connectTimeoutMs: number,
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

    // The client left during the lookup: its `close` already fired, so the
    // cancel listener in `proxyReq` would never run.
    if (req.socket.destroyed) return;

    delete req.headers[INTERNAL_TOKEN_HEADER];
    delete req.headers[BFF_TOKEN_HEADER];
    // Node already answered `100 Continue` to the client; forwarding `Expect`
    // also makes http-proxy skip the `proxyReq` hook (timeout, cancel).
    delete req.headers.expect;
    this.contexts.set(req, {
      target: targetUrl,
      app: appName,
      startedAt: process.hrtime.bigint(),
      connected: false,
      connectTimedOut: false,
      retried: false,
      next,
    });
    await this.proxy(req, res, next);
  }

  /**
   * Bounds the TCP connect of a new socket. A pooled socket that is already
   * connected is left alone. The idle timeout set in `proxyReq` only starts
   * once the socket connects, so without this a host that drops SYNs holds
   * the request until the client gives up.
   */
  private armConnectTimeout(proxyReq: ClientRequest, req: object): void {
    // http-proxy emits `proxyReq` from the request's own `socket` event, so
    // the socket is already assigned here (and listening for `socket` would
    // be too late).
    const socket = proxyReq.socket;
    const context = this.contexts.get(req);
    if (!socket || !context) return;
    if (!socket.connecting) {
      context.connected = true;
      return;
    }
    const timer = setTimeout(() => {
      context.connectTimedOut = true;
      proxyReq.destroy(new Error('upstream connect timeout'));
    }, this.connectTimeoutMs);
    const clear = () => clearTimeout(timer);
    socket.once('connect', () => {
      clear();
      context.connected = true;
    });
    socket.once('close', clear);
  }

  private async retryElsewhere(
    req: Request,
    res: Response,
    context: ProxyContext,
  ): Promise<void> {
    let target: string | undefined;
    try {
      target = await this.loadBalancer.pickRetryUrl(
        context.app,
        context.target,
      );
    } catch {
      target = undefined; // Eureka failed now: answer as the first attempt would
    }
    if (req.socket.destroyed || res.headersSent) return;
    if (!target) {
      res.status(502).json({ message: 'Bad Gateway' });
      return;
    }
    this.metrics.recordUpstreamRetry(context.app);
    context.target = target;
    context.connected = false;
    context.connectTimedOut = false;
    await this.proxy(req, res, context.next);
  }
}
