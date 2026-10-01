/**
 * A `"METHOD /path"` entry, e.g. `"POST /auth"`. Only these methods are
 * recognised so a typo (`"post /auth"`) fails config validation at boot
 * instead of silently never matching.
 */
const METHOD_ENTRY = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/\S*)$/;

/**
 * An entry is either a plain path prefix with no whitespace (`"/auth"`) or a
 * well-formed `"METHOD /path"` pair.
 */
export function isValidPublicPathEntry(entry: string): boolean {
  return /\s/.test(entry) ? METHOD_ENTRY.test(entry) : true;
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Two kinds of entries, matched differently on purpose:
 * - `"/auth"` — any method, prefix match on path segments: matches `/auth` and
 *   `/auth/login`, but not `/authorized` (a naive `startsWith` would).
 * - `"POST /auth"` — that method only, and that exact path only (a trailing
 *   slash is ignored). It deliberately does not open the sub-paths: a method
 *   rule exists to make one endpoint public, so a protected endpoint added
 *   under the same prefix later must not become public by accident.
 */
export function isPublicPath(
  path: string,
  publicPaths: string[],
  method: string,
): boolean {
  const requestMethod = method.toUpperCase();
  return publicPaths.some((entry) => {
    const qualified = METHOD_ENTRY.exec(entry);
    if (qualified) {
      return (
        qualified[1] === requestMethod &&
        stripTrailingSlash(path) === stripTrailingSlash(qualified[2])
      );
    }
    return (
      path === entry ||
      path.startsWith(entry.endsWith('/') ? entry : `${entry}/`)
    );
  });
}
