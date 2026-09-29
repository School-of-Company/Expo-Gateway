/**
 * Prefix match on path segments: "/auth" matches "/auth" and "/auth/login",
 * but not "/authorized" (a naive `startsWith` would wrongly match that).
 */
export function isPublicPath(path: string, publicPaths: string[]): boolean {
  return publicPaths.some(
    (prefix) =>
      path === prefix ||
      path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`),
  );
}
