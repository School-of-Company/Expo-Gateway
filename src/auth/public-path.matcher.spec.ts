import { isPublicPath, isValidPublicPathEntry } from './public-path.matcher';

describe('isPublicPath', () => {
  describe('plain path entries (any method, prefix match)', () => {
    const publicPaths = ['/auth', '/health'];

    it('matches an exact path', () => {
      expect(isPublicPath('/auth', publicPaths, 'GET')).toBe(true);
    });

    it('matches a sub-path', () => {
      expect(isPublicPath('/auth/login', publicPaths, 'GET')).toBe(true);
    });

    it('matches regardless of method', () => {
      expect(isPublicPath('/auth', publicPaths, 'DELETE')).toBe(true);
    });

    it('does not match a similarly-named path', () => {
      expect(isPublicPath('/authorized', publicPaths, 'GET')).toBe(false);
    });

    it('does not match an unrelated path', () => {
      expect(isPublicPath('/forms', publicPaths, 'GET')).toBe(false);
    });
  });

  describe('"METHOD /path" entries', () => {
    const publicPaths = ['POST /auth', 'PATCH /auth', 'POST /auth/signin'];

    it('matches the listed method on the listed path', () => {
      expect(isPublicPath('/auth', publicPaths, 'POST')).toBe(true);
      expect(isPublicPath('/auth', publicPaths, 'PATCH')).toBe(true);
      expect(isPublicPath('/auth/signin', publicPaths, 'POST')).toBe(true);
    });

    it('does not match a method that is not listed for the path', () => {
      expect(isPublicPath('/auth', publicPaths, 'DELETE')).toBe(false);
      expect(isPublicPath('/auth', publicPaths, 'GET')).toBe(false);
      expect(isPublicPath('/auth/signin', publicPaths, 'PATCH')).toBe(false);
    });

    it('does not open sub-paths of the listed path', () => {
      expect(isPublicPath('/auth/withdraw', publicPaths, 'POST')).toBe(false);
    });

    it('ignores a trailing slash on the request path', () => {
      expect(isPublicPath('/auth/', publicPaths, 'POST')).toBe(true);
      expect(isPublicPath('/auth/', publicPaths, 'DELETE')).toBe(false);
    });

    it('compares the method case-insensitively', () => {
      expect(isPublicPath('/auth', publicPaths, 'post')).toBe(true);
    });

    it('does not match a similarly-named path', () => {
      expect(isPublicPath('/authorized', publicPaths, 'POST')).toBe(false);
    });
  });

  it('combines plain and method-qualified entries', () => {
    const publicPaths = ['/health', 'POST /auth'];
    expect(isPublicPath('/health', publicPaths, 'GET')).toBe(true);
    expect(isPublicPath('/auth', publicPaths, 'POST')).toBe(true);
    expect(isPublicPath('/auth', publicPaths, 'DELETE')).toBe(false);
  });
});

describe('isValidPublicPathEntry', () => {
  it('accepts a plain path prefix', () => {
    expect(isValidPublicPathEntry('/auth')).toBe(true);
    expect(isValidPublicPathEntry('/')).toBe(true);
  });

  it('accepts a well-formed "METHOD /path" entry', () => {
    expect(isValidPublicPathEntry('POST /auth')).toBe(true);
    expect(isValidPublicPathEntry('DELETE /auth/signin')).toBe(true);
  });

  it('rejects an entry with an unknown or lowercase method', () => {
    expect(isValidPublicPathEntry('post /auth')).toBe(false);
    expect(isValidPublicPathEntry('FETCH /auth')).toBe(false);
  });

  it('rejects whitespace that is not a single "METHOD /path" pair', () => {
    expect(isValidPublicPathEntry('POST  /auth')).toBe(false);
    expect(isValidPublicPathEntry('POST /auth /x')).toBe(false);
    expect(isValidPublicPathEntry('POST auth')).toBe(false);
    expect(isValidPublicPathEntry('/auth ')).toBe(false);
  });
});
