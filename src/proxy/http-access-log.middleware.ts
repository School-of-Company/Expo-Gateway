import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { readHttpAccessLogEnabled } from '../bootstrap/env';
import { GatewayConfigService } from '../config/gateway-config.service';
import { isDocsPath } from '../docs/docs.paths';
import { isGatewayOwnedPath } from './gateway-owned-paths';
import { RouteResolverService } from './route-resolver.service';

/**
 * One line per request: `<METHOD> <path> status: <code> (<ms>ms)[ -> <app>]`, written
 * when the response finishes, or as 499 when the client leaves first — once,
 * never twice. Runs before the guards, so 401/429 are logged too.
 *
 * The path never carries the query string (it can hold phone numbers or
 * tokens), and no header, cookie or body is logged. `/health` and the docs
 * screen with its OpenAPI fetches are skipped; `/metrics` has its own port.
 * The gateway has no async trace context, so there is nothing to carry over
 * into the `finish` callback.
 */
@Injectable()
export class HttpAccessLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HttpAccess');
  private readonly enabled = readHttpAccessLogEnabled();

  constructor(
    private readonly routeResolver: RouteResolverService,
    private readonly gatewayConfig: GatewayConfigService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // originalUrl, not req.path: the latter is relative to the mount point.
    const path = req.originalUrl.split('?')[0];
    if (!this.enabled || this.isSkipped(path)) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    let logged = false;
    const log = (status: number) => {
      if (logged) {
        return;
      }
      logged = true;
      const ms = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
      const app = this.routeResolver.resolve(path);
      const message = `${req.method} ${path} status: ${status} (${ms}ms)${app ? ` -> ${app}` : ''}`;
      if (status >= 500 || status === 499) {
        this.logger.error(message);
      } else if (status >= 400) {
        this.logger.warn(message);
      } else {
        this.logger.log(message);
      }
    };

    res.once('finish', () => log(res.statusCode));
    res.once('close', () => log(res.writableFinished ? res.statusCode : 499));
    next();
  }

  private isSkipped(path: string): boolean {
    if (isGatewayOwnedPath(path) || isDocsPath(path)) {
      return true;
    }
    const docs = this.gatewayConfig.getDocs();
    return (docs?.services ?? []).some((service) => service.url === path);
  }
}
