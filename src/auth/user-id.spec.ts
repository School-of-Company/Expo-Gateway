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

  it('returns undefined for a non-object payload', () => {
    expect(extractUserId('plain-string-payload')).toBeUndefined();
  });
});
