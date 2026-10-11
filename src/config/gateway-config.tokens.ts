/**
 * Kept in its own file, separate from both `gateway-config.module.ts` (which
 * provides it) and `gateway-config.service.ts` (which injects it) — those two
 * importing this token from each other instead would form a circular
 * require, and whichever side loads first would capture `undefined` at
 * `@Inject()`-decoration time instead of the real symbol.
 */
export const GATEWAY_CONFIG = Symbol('GATEWAY_CONFIG');
