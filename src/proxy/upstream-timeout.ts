// Idle limit on the upstream socket once the client body is in, like nginx's
// proxy_read_timeout default. Idle, not total: a streamed download that keeps
// sending is never cut. A silent upstream is answered 504; one that stalls
// mid-response gets both connections closed (the status is already sent).
// ponytail: one value for every app and profile; move it into the Config
// Server payload (GatewayConfigService) once some route needs a different one.
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 60_000;

// Own file so ProxyModule and ProxyController don't import it from each
// other (see .claude/rules/architecture.md on circular token imports).
export const UPSTREAM_TIMEOUT_MS = Symbol('UPSTREAM_TIMEOUT_MS');

// Limit on opening a NEW TCP connection to an instance, separate from the idle
// limit above (which Node only starts once the socket is connected). A dead
// host that silently drops SYNs would otherwise hold the request until the
// client gives up (60s in the load test, #105). Upstreams sit on the same
// network, where a handshake takes well under a millisecond, so 2s only trips
// on an instance that is gone. A reused keep-alive socket is already connected
// and is never subject to it.
export const DEFAULT_UPSTREAM_CONNECT_TIMEOUT_MS = 2_000;

export const UPSTREAM_CONNECT_TIMEOUT_MS = Symbol(
  'UPSTREAM_CONNECT_TIMEOUT_MS',
);
