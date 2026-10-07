import { generateKeyPairSync } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { verifyAccessToken } from './jwt-verify';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const publicKeyPem = publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();
const privateKeyPem = privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();
const now = 1_800_000_000;

describe('verifyAccessToken lifetime', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['expired', { iat: now - 900, exp: now }, false],
    ['future iat', { iat: now + 1, exp: now + 900 }, false],
    ['over 15 minutes', { iat: now, exp: now + 901 }, false],
    ['exactly 15 minutes', { iat: now, exp: now + 900 }, true],
    ['under 15 minutes', { iat: now, exp: now + 899 }, true],
    ['missing iat', { exp: now + 900 }, false],
    ['missing exp', { iat: now }, false],
    ['missing both claims', {}, false],
  ])('%s', (_name, claims, accepted) => {
    const token = jwt.sign({ sub: 'user-1', ...claims }, privateKeyPem, {
      algorithm: 'RS256',
      noTimestamp: !('iat' in claims),
    });
    if (accepted) {
      expect(verifyAccessToken(token, publicKeyPem)).toMatchObject(claims);
    } else {
      expect(() => verifyAccessToken(token, publicKeyPem)).toThrow(
        jwt.JsonWebTokenError,
      );
    }
  });

  it('rejects a tampered token with otherwise valid lifetime', () => {
    const token = jwt.sign(
      { sub: 'user-1', iat: now, exp: now + 900 },
      privateKeyPem,
      { algorithm: 'RS256' },
    );
    const index = token.length - 10;
    const tampered =
      token.slice(0, index) +
      (token[index] === 'a' ? 'b' : 'a') +
      token.slice(index + 1);
    expect(() => verifyAccessToken(tampered, publicKeyPem)).toThrow(
      'invalid signature',
    );
  });
});
