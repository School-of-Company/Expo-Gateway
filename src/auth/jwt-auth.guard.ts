import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { GatewayConfigService } from '../config/gateway-config.service';
import { isPublicPath } from './public-path.matcher';
import { verifyAccessToken } from './jwt-verify';
import { extractUserId, USER_ID_HEADER } from './user-id';
import { extractUserRole, USER_ROLE_HEADER } from './user-role';

/**
 * Global guard (registered as APP_GUARD in AppModule). There are no
 * per-domain route handlers in this gateway to hang a `@Public()` decorator
 * on — it's a single catch-all proxy controller — so the bypass list comes
 * from boot-time config (`publicPaths`) and is matched against the request
 * path directly.
 *
 * Identity is handed to backends as `X-User-Id` (and, when the token carries
 * one, `X-User-Role`), taken from the verified token. Any client-supplied
 * value of either header is removed first on every request (public paths
 * included), so only this guard can ever set them.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly gatewayConfig: GatewayConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    delete request.headers[USER_ID_HEADER];
    delete request.headers[USER_ROLE_HEADER];

    if (isPublicPath(request.path, this.gatewayConfig.getPublicPaths())) {
      return true;
    }

    const header = request.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const token = header.slice('Bearer '.length);
    let userId: string | undefined;
    let role: string | undefined;
    try {
      const payload = verifyAccessToken(
        token,
        this.gatewayConfig.getJwtPublicKey(),
      );
      userId = extractUserId(payload);
      role = extractUserRole(payload);
    } catch {
      throw new UnauthorizedException();
    }
    if (!userId) {
      throw new UnauthorizedException();
    }

    request.headers[USER_ID_HEADER] = userId;
    if (role) {
      request.headers[USER_ROLE_HEADER] = role;
    }
    return true;
  }
}
