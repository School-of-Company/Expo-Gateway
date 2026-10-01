export const USER_ID_HEADER = 'x-user-id';
export const USER_ID_CLAIM = 'sub';

export function extractUserId(
  payload: Record<string, unknown> | string,
): string | undefined {
  if (typeof payload === 'string') {
    return undefined;
  }
  const value = payload[USER_ID_CLAIM];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}
