import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { GatewayConfigService } from '../config/gateway-config.service';
import {
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_METHODS,
  CORS_EXPOSED_HEADERS,
  CORS_MAX_AGE_SECONDS,
  isStateChangingMethod,
} from './cors.policy';

/**
 * Credentialed CORS plus the gateway half of CSRF protection, active only
 * when Config Server sends `cors.allowedOrigins`.
 *
 * - An allowed `Origin` is echoed back with `Allow-Credentials` (never `*`).
 * - Preflights are answered here and never reach the guards or a backend.
 * - A state-changing request whose `Origin` is present but not allowed is
 *   rejected with 403 before anything is forwarded. Browsers always send
 *   `Origin` on cross-site POST/PUT/PATCH/DELETE, so this is what stops a
 *   foreign page from riding the participant session cookie. A request with
 *   no `Origin` (curl, server-to-server, the mobile app) is not a browser
 *   CSRF vector and passes; backends still enforce their own CSRF token.
 */
@Injectable()
export class CorsMiddleware implements NestMiddleware {
  constructor(private readonly gatewayConfig: GatewayConfigService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const allowedOrigins = this.gatewayConfig.getCorsAllowedOrigins();
    if (!allowedOrigins) {
      next();
      return;
    }
    res.vary('Origin');
    const origin = req.headers.origin;
    if (origin === undefined) {
      next();
      return;
    }

    const allowed = allowedOrigins.includes(origin);
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    const isPreflight =
      req.method === 'OPTIONS' &&
      req.headers['access-control-request-method'] !== undefined;
    if (isPreflight && allowed) {
      res.setHeader('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', CORS_MAX_AGE_SECONDS);
      res.status(204).end();
      return;
    }
    if (allowed) {
      res.setHeader('Access-Control-Expose-Headers', CORS_EXPOSED_HEADERS);
    }
    if (!allowed && (isPreflight || isStateChangingMethod(req.method))) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }
    next();
  }
}
