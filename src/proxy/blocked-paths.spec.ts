import { isBlockedPath } from './blocked-paths';

describe('isBlockedPath', () => {
  it.each([
    '/internal/participant-sessions/resolve',
    '/user/internal/x',
    '/INTERNAL/x',
    '/%69nternal/x',
    '/%2569nternal/x',
    '/participant-auth/..%2finternal/x',
    '/participant-auth%5cinternal',
    '/internal;jsessionid=1/x',
    '/application/../admin',
    '/application/./1',
    '/application/%2e%2e/admin',
    '/bad%E0%A4%A',
  ])('blocks %s', (path) => {
    expect(isBlockedPath(path)).toBe(true);
  });

  it.each([
    '/participant-auth/session',
    '/application/expos/1/my-applications',
    '/internals',
    '/internal-notes',
    '/surveys/%EC%84%A4%EB%AC%B8',
    '/',
  ])('allows %s', (path) => {
    expect(isBlockedPath(path)).toBe(false);
  });
});
