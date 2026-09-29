import { generateKeyPairSync } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { GatewayConfigService } from '../config/gateway-config.service';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const publicKeyPem = publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();
const privateKeyPem = privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();

function makeContext(
  path: string,
  headers: Record<string, string>,
): ExecutionContext {
  const request = { path, headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeGuard(publicPaths: string[] = []): JwtAuthGuard {
  const gatewayConfig = {
    getPublicPaths: () => publicPaths,
    getJwtPublicKey: () => publicKeyPem,
  } as unknown as GatewayConfigService;
  return new JwtAuthGuard(gatewayConfig);
}

describe('JwtAuthGuard', () => {
  it('allows a public path through without a token', () => {
    const guard = makeGuard(['/auth']);
    expect(guard.canActivate(makeContext('/auth/login', {}))).toBe(true);
  });

  it('rejects a protected path with no Authorization header', () => {
    const guard = makeGuard([]);
    expect(() => guard.canActivate(makeContext('/forms', {}))).toThrow(
      UnauthorizedException,
    );
  });

  it('allows a valid RS256 token through', () => {
    const guard = makeGuard([]);
    const token = jwt.sign({ sub: 'user-1' }, privateKeyPem, {
      algorithm: 'RS256',
      expiresIn: '5m',
    });
    expect(
      guard.canActivate(
        makeContext('/forms', { authorization: `Bearer ${token}` }),
      ),
    ).toBe(true);
  });

  it('rejects an expired token', () => {
    const guard = makeGuard([]);
    const token = jwt.sign({ sub: 'user-1' }, privateKeyPem, {
      algorithm: 'RS256',
      expiresIn: -10,
    });
    expect(() =>
      guard.canActivate(
        makeContext('/forms', { authorization: `Bearer ${token}` }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a tampered/invalid-signature token', () => {
    const guard = makeGuard([]);
    const token = jwt.sign({ sub: 'user-1' }, privateKeyPem, {
      algorithm: 'RS256',
      expiresIn: '5m',
    });
    // Flip a character well before the end (not the last char, whose base64url
    // position can encode only unused padding bits and so may not change the
    // decoded signature bytes at all).
    const flipIndex = token.length - 10;
    const flipped = token[flipIndex] === 'a' ? 'b' : 'a';
    const tampered =
      token.slice(0, flipIndex) + flipped + token.slice(flipIndex + 1);
    expect(() =>
      guard.canActivate(
        makeContext('/forms', { authorization: `Bearer ${tampered}` }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects an alg-confusion attempt (HS256 signed using the public key as an HMAC secret)', () => {
    const guard = makeGuard([]);
    const forged = jwt.sign({ sub: 'attacker' }, publicKeyPem, {
      algorithm: 'HS256',
      expiresIn: '5m',
    });
    expect(() =>
      guard.canActivate(
        makeContext('/forms', { authorization: `Bearer ${forged}` }),
      ),
    ).toThrow(UnauthorizedException);
  });
});
