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

  describe('"METHOD /path/{param}" entries', () => {
    const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const publicPaths = [
      'POST /application/{expoId}',
      'GET /application/expos/{expoId}/my-applications',
      'POST /application/expos/{expoId}/my-applications/{type:STANDARD|TRAINING}/{applicationId}/cancellation',
    ];

    it('matches a decimal or UUID id per {name} segment', () => {
      expect(isPublicPath('/application/12', publicPaths, 'POST')).toBe(true);
      expect(isPublicPath(`/application/${UUID}/`, publicPaths, 'POST')).toBe(
        true,
      );
      expect(
        isPublicPath(
          `/application/expos/${UUID}/my-applications`,
          publicPaths,
          'GET',
        ),
      ).toBe(true);
    });

    it('does not open a same-depth sibling with a word in the id slot', () => {
      for (const word of ['admin', 'pre-standard', 'field', 'expos']) {
        expect(isPublicPath(`/application/${word}`, publicPaths, 'POST')).toBe(
          false,
        );
      }
    });

    it('matches a {name:A|B} segment only against the listed values', () => {
      const path = (type: string) =>
        `/application/expos/1/my-applications/${type}/9/cancellation`;
      expect(isPublicPath(path('STANDARD'), publicPaths, 'POST')).toBe(true);
      expect(isPublicPath(path('TRAINING'), publicPaths, 'POST')).toBe(true);
      expect(isPublicPath(path('standard'), publicPaths, 'POST')).toBe(false);
      expect(isPublicPath(path('ADMIN'), publicPaths, 'POST')).toBe(false);
    });

    it('keeps the method and the segment count exact', () => {
      expect(isPublicPath('/application/12', publicPaths, 'GET')).toBe(false);
      expect(isPublicPath('/application', publicPaths, 'POST')).toBe(false);
      expect(isPublicPath('/application/12/x', publicPaths, 'POST')).toBe(
        false,
      );
      expect(
        isPublicPath(
          '/application/expos/3/my-applications/1',
          publicPaths,
          'GET',
        ),
      ).toBe(false);
    });

    it('rejects traversal, encoded and empty values', () => {
      for (const value of ['..', '.', '%2e%2e', '1%2Finternal', '1;b', '']) {
        expect(isPublicPath(`/application/${value}`, publicPaths, 'POST')).toBe(
          false,
        );
      }
    });

    it('treats a literal brace in the request path as data, not a pattern', () => {
      expect(isPublicPath('/application/{expoId}', publicPaths, 'POST')).toBe(
        false,
      );
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

  it('accepts whole-segment {name} / {name:A|B} placeholders on method entries only', () => {
    expect(isValidPublicPathEntry('POST /application/{expoId}')).toBe(true);
    expect(isValidPublicPathEntry('GET /a/{x}/b/{y2}')).toBe(true);
    expect(isValidPublicPathEntry('/application/{expoId}')).toBe(false);
    expect(isValidPublicPathEntry('POST /application/x{expoId}')).toBe(false);
    expect(isValidPublicPathEntry('POST /application/{expo-id}')).toBe(false);
    expect(isValidPublicPathEntry('POST /application/{}')).toBe(false);
    expect(isValidPublicPathEntry('POST /a/{type:STANDARD|TRAINING}')).toBe(
      true,
    );
    expect(isValidPublicPathEntry('POST /a/{type:}')).toBe(false);
    expect(isValidPublicPathEntry('POST /a/{type:A||B}')).toBe(false);
  });
});
