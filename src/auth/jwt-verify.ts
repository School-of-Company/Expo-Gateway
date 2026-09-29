import * as jwt from 'jsonwebtoken';

/**
 * Verify-only: the gateway never signs tokens (issued by expo-expo-server's
 * `/auth`). `algorithms: ['RS256']` must always be passed explicitly —
 * omitting it is the classic JWT "alg confusion" vulnerability, where a
 * token signed with `alg: none` or HS256-using-the-public-key-as-secret
 * would otherwise validate. Throws on any invalid/expired/wrong-alg token.
 */
export function verifyAccessToken(
  token: string,
  publicKey: string,
): jwt.JwtPayload | string {
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] });
}
