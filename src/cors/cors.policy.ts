import type { IncomingHttpHeaders } from 'node:http';

export const CORS_ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE';
/**
 * Fixed on purpose: every extra header a browser may send cross-origin is an
 * API decision. Application's two Spring CSRF chains read `X-CSRF-TOKEN`
 * (my-applications, session-stored token + JSESSIONID) and `X-XSRF-TOKEN`
 * (program sessions, `CookieCsrfTokenRepository` default); program
 * applications and registrations take `Idempotency-Key`; `Authorization` is
 * the admin JWT.
 */
export const CORS_ALLOWED_HEADERS =
  'Authorization, Content-Type, X-CSRF-TOKEN, X-XSRF-TOKEN, Idempotency-Key';
/**
 * `GET .../my-applications` hands the cancellation token back in
 * `X-CSRF-TOKEN`; the SMS-code budget's wait time is in its `Retry-After-*`.
 */
export const CORS_EXPOSED_HEADERS =
  'X-CSRF-TOKEN, Retry-After-participantAuthCode';
export const CORS_MAX_AGE_SECONDS = '600';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isStateChangingMethod(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

/** `scheme://host[:port]` exactly as a browser sends it in `Origin` — no `*`, path, or trailing slash. */
export function isExactOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

/**
 * The gateway is the only CORS owner while `cors` is configured: an upstream
 * `Access-Control-*` header would overwrite (or duplicate) the gateway's, so
 * it is dropped, and `Vary: Origin` survives the upstream's own `Vary`.
 */
export function stripUpstreamCorsHeaders(headers: IncomingHttpHeaders): void {
  for (const name of Object.keys(headers)) {
    if (name.startsWith('access-control-')) {
      delete headers[name];
    }
  }
  const vary = headers.vary;
  if (!vary) {
    headers.vary = 'Origin';
  } else if (
    vary.trim() !== '*' &&
    !vary.split(',').some((v) => v.trim().toLowerCase() === 'origin')
  ) {
    headers.vary = `${vary}, Origin`;
  }
}
