// Idle limit on the upstream socket (no bytes either way), like nginx's
// proxy_read_timeout default. Idle, not total: a long upload or a streamed
// download keeps the socket busy and is never cut, while an upstream that
// accepted the connection and then went silent is answered 504.
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 60_000;

// Own file so ProxyModule and ProxyController don't import it from each
// other (see .claude/rules/architecture.md on circular token imports).
export const UPSTREAM_TIMEOUT_MS = Symbol('UPSTREAM_TIMEOUT_MS');
