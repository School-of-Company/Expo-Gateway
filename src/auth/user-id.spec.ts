import { extractUserId } from './user-id';

describe('extractUserId', () => {
  it('returns a string subject', () => {
    expect(extractUserId({ sub: 'user-1' })).toBe('user-1');
  });

  it('stringifies a finite numeric subject', () => {
    expect(extractUserId({ sub: 7 })).toBe('7');
  });

  it('returns undefined when the subject is missing, empty, or not a string/number', () => {
    expect(extractUserId({})).toBeUndefined();
    expect(extractUserId({ sub: '' })).toBeUndefined();
    expect(extractUserId({ sub: Number.NaN })).toBeUndefined();
    expect(extractUserId({ sub: { id: 1 } })).toBeUndefined();
  });

  it('keeps plain string ids that are safe as a header value', () => {
    for (const sub of [
      'user-1',
      '42',
      '0f8fa1c2-5b8e-4c1a-9a51-3d2b7c0e9f10',
      'auth0|abc.def_123',
      'a b',
    ]) {
      expect(extractUserId({ sub })).toBe(sub);
    }
  });

  it.each([
    ['CR/LF header injection', 'user\r\nX-User-Role: ADMIN'],
    ['bare LF', 'user\nx'],
    ['bare CR', 'user\rx'],
    ['NUL', 'user\u0000'],
    ['DEL', 'user\u007f'],
    ['tab', 'user\tx'],
    ['leading space', ' user'],
    ['trailing space', 'user '],
    ['non-ASCII', '사용자'],
    ['Latin-1 obs-text', 'caf\u00e9'],
  ])('rejects a subject unsafe as a header value (%s)', (_name, sub) => {
    expect(extractUserId({ sub })).toBeUndefined();
  });

  it('returns undefined for a non-object payload', () => {
    expect(extractUserId('plain-string-payload')).toBeUndefined();
  });
});
