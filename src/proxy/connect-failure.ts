/**
 * Why a connection to an upstream instance could not be opened. Only failures
 * that happen before the socket connects count: the instance never saw a byte
 * of the request, so excluding it and retrying elsewhere are both safe.
 * A reset on an established socket (ECONNRESET) is deliberately not here —
 * the upstream may already have acted on the request.
 */
export type ConnectFailureReason = 'refused' | 'timeout' | 'unreachable';

const UNREACHABLE_CODES = new Set([
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'ENETDOWN',
]);

export function connectFailureReason(
  err: unknown,
  state: { connected: boolean; connectTimedOut: boolean },
): ConnectFailureReason | undefined {
  if (state.connectTimedOut) return 'timeout';
  if (state.connected) return undefined;
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ECONNREFUSED') return 'refused';
  if (code === 'ETIMEDOUT') return 'timeout'; // the kernel gave up on the SYN
  if (code !== undefined && UNREACHABLE_CODES.has(code)) return 'unreachable';
  return undefined;
}
