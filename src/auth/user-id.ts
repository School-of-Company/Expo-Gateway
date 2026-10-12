export const USER_ID_HEADER = 'x-user-id';
export const USER_ID_CLAIM = 'sub';

/**
 * The subject goes straight into a request header. Anything else (CR/LF, other
 * control characters, non-ASCII, edge whitespace a parser would trim) is
 * treated as no usable id — the guard answers 401 instead of the proxy
 * throwing ERR_INVALID_CHAR. Printable ASCII with inner spaces only; no id
 * format (UUID, numeric) is imposed.
 */
const USER_ID_PATTERN = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/;

export function extractUserId(
  payload: Record<string, unknown> | string,
): string | undefined {
  if (typeof payload === 'string') {
    return undefined;
  }
  const value = payload[USER_ID_CLAIM];
  if (typeof value === 'string' && USER_ID_PATTERN.test(value)) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}
