import { isDocsPath, isPublicDocsRequest } from './docs.paths';

describe('isDocsPath', () => {
  it('/docs와 그 하위만 맞는다', () => {
    expect(isDocsPath('/docs')).toBe(true);
    expect(isDocsPath('/docs/config.json')).toBe(true);
    expect(isDocsPath('/docsx')).toBe(false);
    expect(isDocsPath('/attendance/docs')).toBe(false);
  });
});

describe('isPublicDocsRequest', () => {
  it('꺼져 있으면 항상 false다', () => {
    expect(isPublicDocsRequest(false, '/docs', 'GET')).toBe(false);
  });

  it('켜져 있으면 /docs 하위의 GET/HEAD만 연다', () => {
    expect(isPublicDocsRequest(true, '/docs', 'GET')).toBe(true);
    expect(
      isPublicDocsRequest(true, '/docs/assets/swagger-ui.css', 'get'),
    ).toBe(true);
    expect(isPublicDocsRequest(true, '/docs', 'HEAD')).toBe(true);
    expect(isPublicDocsRequest(true, '/docs', 'POST')).toBe(false);
    expect(isPublicDocsRequest(true, '/forms', 'GET')).toBe(false);
  });
});
