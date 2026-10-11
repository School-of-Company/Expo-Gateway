import * as jwt from 'jsonwebtoken';

/**
 * Verify-only: the gateway never signs tokens (issued by the Auth service's
 * `/auth`). `algorithms: ['RS256']` must always be passed explicitly —
 * omitting it is the classic JWT "alg confusion" vulnerability, where a
 * token signed with `alg: none` or HS256-using-the-public-key-as-secret
 * would otherwise validate. Throws on any invalid/expired/wrong-alg token.
 */
export function verifyAccessToken(
  token: string,
  publicKey: string,
): jwt.JwtPayload {
  const payload = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
  if (
    typeof payload === 'string' ||
    typeof payload.iat !== 'number' ||
    !Number.isFinite(payload.iat) ||
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.exp) ||
    payload.iat > Math.floor(Date.now() / 1000) ||
    payload.exp - payload.iat > 900
  ) {
    throw new jwt.JsonWebTokenError('invalid access token lifetime');
  }
  return payload;
}
