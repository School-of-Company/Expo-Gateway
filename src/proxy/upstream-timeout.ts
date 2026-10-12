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
