import { isPublicPath } from './public-path.matcher';

describe('isPublicPath', () => {
  const publicPaths = ['/auth', '/health'];

  it('matches an exact path', () => {
    expect(isPublicPath('/auth', publicPaths)).toBe(true);
  });

  it('matches a sub-path', () => {
    expect(isPublicPath('/auth/login', publicPaths)).toBe(true);
  });

  it('does not match a similarly-named path', () => {
    expect(isPublicPath('/authorized', publicPaths)).toBe(false);
  });

  it('does not match an unrelated path', () => {
    expect(isPublicPath('/v1/forms', publicPaths)).toBe(false);
  });
});
