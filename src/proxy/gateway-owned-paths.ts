/**
 * Paths this gateway serves itself and must never proxy. The proxy's
 * `@All('/{*splat}')` catch-all matches these too, so the controller
 * explicitly falls through to `next()` for them regardless of Nest's
 * controller/route registration order — Express continues scanning its route
 * stack from wherever `next()` is called, so this is correct whether the
 * owning controller's route was registered before or after the catch-all.
 */
export const GATEWAY_OWNED_PATHS = ['/health'];

export function isGatewayOwnedPath(path: string): boolean {
  return GATEWAY_OWNED_PATHS.some(
    (owned) => path === owned || path.startsWith(`${owned}/`),
  );
}
