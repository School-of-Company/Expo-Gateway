import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from '../metrics/metrics.service';
import { isGatewayOwnedPath } from './gateway-owned-paths';
import { RouteResolverService } from './route-resolver.service';

/**
 * Runs before the guards, so requests rejected by JwtAuthGuard (401) or the
 * throttler (429) are measured too. A request the client abandons before the
 * response finishes is recorded as 499 (nginx's convention).
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(
    private readonly metrics: MetricsService,
    private readonly routeResolver: RouteResolverService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    let recorded = false;

    const record = (status: number) => {
      if (recorded) {
        return;
      }
      recorded = true;
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      this.metrics.recordRequest(
        req.method,
        status,
        this.appLabel(req),
        seconds,
      );
    };

    res.once('finish', () => record(res.statusCode));
    res.once('close', () =>
      record(res.writableFinished ? res.statusCode : 499),
    );
    next();
  }

  // originalUrl, not req.path: the latter is relative to wherever Nest mounts
  // the middleware.
  private appLabel(req: Request): string {
    const path = req.originalUrl.split('?')[0];
    if (isGatewayOwnedPath(path)) {
      return 'gateway';
    }
    return this.routeResolver.resolve(path) ?? 'unmatched';
  }
}
