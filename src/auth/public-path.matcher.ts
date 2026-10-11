/**
 * A `"METHOD /path"` entry, e.g. `"POST /auth"`. Only these methods are
 * recognised so a typo (`"post /auth"`) fails config validation at boot
 * instead of silently never matching.
 */
const METHOD_ENTRY = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/\S*)$/;

/**
 * A placeholder segment in a method-qualified entry:
 * - `{expoId}` — an id: a decimal number or a UUID.
 * - `{type:STANDARD|TRAINING}` — exactly one of the listed values.
 * Neither accepts an arbitrary word, so `POST /application/{expoId}` does not
 * also open a sibling such as `POST /application/admin`, and nothing with
 * `.`, `%` or `;` can ride a public pattern into another endpoint.
 */
const PARAM_SEGMENT =
  /^\{[A-Za-z][A-Za-z0-9]*(?::([A-Za-z0-9_-]+(?:\|[A-Za-z0-9_-]+)*))?\}$/;

const ID_VALUE =
  /^(?:[0-9]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

/**
 * An entry is either a plain path prefix with no whitespace (`"/auth"`) or a
 * well-formed `"METHOD /path"` pair. Braces are only valid as a whole
 * `{name}` segment of a method-qualified entry.
 */
export function isValidPublicPathEntry(entry: string): boolean {
  if (!/\s/.test(entry)) {
    return !/[{}]/.test(entry);
  }
  const qualified = METHOD_ENTRY.exec(entry);
  return (
    qualified !== null &&
    qualified[2]
      .split('/')
      .every((segment) => !/[{}]/.test(segment) || PARAM_SEGMENT.test(segment))
  );
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function matchesTemplate(path: string, template: string): boolean {
  const actual = stripTrailingSlash(path).split('/');
  const expected = stripTrailingSlash(template).split('/');
  return (
    actual.length === expected.length &&
    expected.every((segment, i) => {
      const param = PARAM_SEGMENT.exec(segment);
      if (!param) return segment === actual[i];
      return param[1] === undefined
        ? ID_VALUE.test(actual[i])
        : param[1].split('|').includes(actual[i]);
    })
  );
}

/**
 * Two kinds of entries, matched differently on purpose:
 * - `"/auth"` — any method, prefix match on path segments: matches `/auth` and
 *   `/auth/login`, but not `/authorized` (a naive `startsWith` would).
 * - `"POST /auth"` — that method only, and that exact path only (a trailing
 *   slash is ignored). It deliberately does not open the sub-paths: a method
 *   rule exists to make one endpoint public, so a protected endpoint added
 *   under the same prefix later must not become public by accident. A
 *   placeholder segment (`"POST /application/{expoId}"`) matches exactly one
 *   id or listed value (see `PARAM_SEGMENT`); the segment count must match.
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
        qualified[1] === requestMethod && matchesTemplate(path, qualified[2])
      );
    }
    return (
      path === entry ||
      path.startsWith(entry.endsWith('/') ? entry : `${entry}/`)
    );
  });
}
