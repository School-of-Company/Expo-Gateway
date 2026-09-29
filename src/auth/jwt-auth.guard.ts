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

/**
 * Global guard (registered as APP_GUARD in AppModule). There are no
 * per-domain route handlers in this gateway to hang a `@Public()` decorator
 * on — it's a single catch-all proxy controller — so the bypass list comes
 * from boot-time config (`publicPaths`) and is matched against the request
 * path directly.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly gatewayConfig: GatewayConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (isPublicPath(request.path, this.gatewayConfig.getPublicPaths())) {
      return true;
    }

    const header = request.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const token = header.slice('Bearer '.length);
    try {
      verifyAccessToken(token, this.gatewayConfig.getJwtPublicKey());
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
