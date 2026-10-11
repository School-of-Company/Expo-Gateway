import { extractUserRole } from './user-role';

describe('extractUserRole', () => {
  it('returns a plain role name', () => {
    expect(extractUserRole({ role: 'ROLE_ADMIN' })).toBe('ROLE_ADMIN');
    expect(extractUserRole({ role: 'ns:admin' })).toBe('ns:admin');
  });

  it('returns undefined when the claim is missing, empty, or not a string', () => {
    expect(extractUserRole({})).toBeUndefined();
    expect(extractUserRole({ role: '' })).toBeUndefined();
    expect(extractUserRole({ role: 1 })).toBeUndefined();
    expect(extractUserRole({ role: ['ROLE_ADMIN'] })).toBeUndefined();
  });

  it('returns undefined for a value that is unsafe to put in a header', () => {
    expect(
      extractUserRole({ role: 'ROLE_ADMIN\r\nX-Evil: 1' }),
    ).toBeUndefined();
    expect(extractUserRole({ role: 'role with space' })).toBeUndefined();
    expect(extractUserRole({ role: 'A'.repeat(65) })).toBeUndefined();
  });

  it('returns undefined for a non-object payload', () => {
    expect(extractUserRole('plain-string-payload')).toBeUndefined();
  });
});
