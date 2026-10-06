export const USER_ROLE_HEADER = 'x-user-role';
export const USER_ROLE_CLAIM = 'role';

/**
 * The value goes straight into a request header, so anything outside a plain
 * role-name alphabet (`ROLE_ADMIN`, `admin`, `ns:admin`) is treated as absent
 * rather than forwarded — a header value with control characters would
 * otherwise make the proxy throw instead of answering.
 */
const ROLE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

export function extractUserRole(
  payload: Record<string, unknown> | string,
): string | undefined {
  if (typeof payload === 'string') {
    return undefined;
  }
  const value = payload[USER_ROLE_CLAIM];
  if (typeof value === 'string' && ROLE_PATTERN.test(value)) {
    return value;
  }
  return undefined;
}
