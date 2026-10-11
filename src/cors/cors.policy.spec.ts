import type { IncomingHttpHeaders } from 'node:http';
import { stripUpstreamCorsHeaders } from './cors.policy';

describe('stripUpstreamCorsHeaders', () => {
  const strip = (headers: IncomingHttpHeaders) => {
    stripUpstreamCorsHeaders(headers);
    return headers;
  };

  it('drops every upstream Access-Control-* header', () => {
    expect(
      strip({
        'access-control-allow-origin': '*',
        'access-control-allow-credentials': 'true',
        'content-type': 'application/json',
      }),
    ).toEqual({ 'content-type': 'application/json', vary: 'Origin' });
  });

  it.each([
    [undefined, 'Origin'],
    ['Accept-Encoding', 'Accept-Encoding, Origin'],
    ['origin, Accept', 'origin, Accept'],
    ['*', '*'],
  ])('turns Vary %p into %p', (vary, expected) => {
    expect(strip(vary === undefined ? {} : { vary }).vary).toBe(expected);
  });
});
