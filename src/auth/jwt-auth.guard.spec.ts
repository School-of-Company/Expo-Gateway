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
  describe('X-User-Id', () => {
    function signToken(claims: Record<string, unknown>): string {
      return jwt.sign(claims, privateKeyPem, {
        algorithm: 'RS256',
        expiresIn: '5m',
      });
    }

    it('sets x-user-id from the verified token subject', () => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${signToken({ sub: 'user-1' })}`,
      };
      makeGuard([]).canActivate(makeContext('/forms', headers));
      expect(headers['x-user-id']).toBe('user-1');
    });

    it('stringifies a numeric subject', () => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${signToken({ sub: 42 })}`,
      };
      makeGuard([]).canActivate(makeContext('/forms', headers));
      expect(headers['x-user-id']).toBe('42');
    });

    it('overwrites a client-supplied x-user-id with the token subject', () => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${signToken({ sub: 'user-1' })}`,
        'x-user-id': 'attacker',
      };
      makeGuard([]).canActivate(makeContext('/forms', headers));
      expect(headers['x-user-id']).toBe('user-1');
    });

    it('strips a client-supplied x-user-id on a public path', () => {
      const headers: Record<string, string> = { 'x-user-id': 'attacker' };
      makeGuard(['/auth']).canActivate(makeContext('/auth/login', headers));
      expect(headers['x-user-id']).toBeUndefined();
    });

    it('rejects a valid token that has no subject', () => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${signToken({ role: 'admin' })}`,
        'x-user-id': 'attacker',
      };
      expect(() =>
        makeGuard([]).canActivate(makeContext('/forms', headers)),
      ).toThrow(UnauthorizedException);
      expect(headers['x-user-id']).toBeUndefined();
    });
  });

  describe('X-User-Role', () => {
    function signToken(claims: Record<string, unknown>): string {
      return jwt.sign(claims, privateKeyPem, {
        algorithm: 'RS256',
        expiresIn: '5m',
      });
    }

    it('sets x-user-role from the verified token role claim', () => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${signToken({ sub: 'user-1', role: 'ROLE_ADMIN' })}`,
      };
      makeGuard([]).canActivate(makeContext('/forms', headers));
      expect(headers['x-user-role']).toBe('ROLE_ADMIN');
    });

    it('overwrites a client-supplied x-user-role with the token role', () => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${signToken({ sub: 'user-1', role: 'ROLE_STANDARD' })}`,
        'x-user-role': 'ROLE_ADMIN',
      };
      makeGuard([]).canActivate(makeContext('/forms', headers));
      expect(headers['x-user-role']).toBe('ROLE_STANDARD');
    });

    it('removes a client-supplied x-user-role when the token has no role claim', () => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${signToken({ sub: 'user-1' })}`,
        'x-user-role': 'ROLE_ADMIN',
      };
      makeGuard([]).canActivate(makeContext('/forms', headers));
      expect(headers['x-user-id']).toBe('user-1');
      expect(headers['x-user-role']).toBeUndefined();
    });

    it('does not forward a role value that is not a plain role name', () => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${signToken({ sub: 'user-1', role: 'ROLE_ADMIN\r\nX-Evil: 1' })}`,
      };
      makeGuard([]).canActivate(makeContext('/forms', headers));
      expect(headers['x-user-role']).toBeUndefined();
    });

    it('strips a client-supplied x-user-role on a public path', () => {
      const headers: Record<string, string> = { 'x-user-role': 'ROLE_ADMIN' };
      makeGuard(['/auth']).canActivate(makeContext('/auth/login', headers));
      expect(headers['x-user-role']).toBeUndefined();
    });

    it('strips x-user-role when a token with a role but no subject is rejected', () => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${signToken({ role: 'ROLE_ADMIN' })}`,
        'x-user-role': 'ROLE_ADMIN',
      };
      expect(() =>
        makeGuard([]).canActivate(makeContext('/forms', headers)),
      ).toThrow(UnauthorizedException);
      expect(headers['x-user-role']).toBeUndefined();
    });
  });
});
