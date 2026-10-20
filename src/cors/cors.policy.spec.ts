import type { IncomingHttpHeaders } from 'node:http';
import {
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSED_HEADERS,
  stripUpstreamCorsHeaders,
} from './cors.policy';

describe('CORS header lists', () => {
  const names = (list: string) => list.split(',').map((h) => h.trim());

  it('allows X-Scanner-Name on cross-origin requests', () => {
    expect(names(CORS_ALLOWED_HEADERS)).toContain('X-Scanner-Name');
  });

  it.each(['participantAuthCode', 'sms', 'survey', 'signin'])(
    'exposes Retry-After-%s to the page',
    (budget) => {
      expect(names(CORS_EXPOSED_HEADERS)).toContain(`Retry-After-${budget}`);
    },
  );
});

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
