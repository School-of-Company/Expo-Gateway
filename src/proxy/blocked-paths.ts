/** Service-to-service header; a browser must never be able to send it through. */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

const MAX_DECODE_ROUNDS = 3;

/**
 * Backends keep service-to-service endpoints under `/internal/**`, guarded
 * only by `X-Internal-Token`. Whatever the routing table says, the gateway
 * never forwards a path that has an `internal` segment, or a `.`/`..`
 * segment that could resolve into one (or into some other unrouted path)
 * after the backend normalises it. Segments are compared after repeated
 * percent-decoding and with any `;matrix` suffix removed, since that is what
 * a servlet container would see; an undecodable path is blocked too.
 */
export function isBlockedPath(path: string): boolean {
  let decoded = path;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return true;
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded
    .toLowerCase()
    .split(/[/\\]/)
    .map((segment) => segment.split(';')[0].trim())
    .some(
      (segment) =>
        segment === 'internal' || segment === '.' || segment === '..',
    );
}
