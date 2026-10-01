# Gateway Security Rules

## Strictly Forbidden

- Reading or printing `.env`, `.env.*` files (`.env.example` is fine — it's a template with no
  real values)
- Printing a JWT signing/public key, a raw Bearer token, or the Config Server response body in logs
- Hardcoding a JWT key, Eureka URL, or Config Server URL in code — these come from
  `GatewayConfigService`/`src/bootstrap/env.ts` only
- Committing a real PEM key or `.p8`/`.pem` file into this repo
- Letting a client-supplied `X-User-Id` reach a backend — only `JwtAuthGuard` may set it, from a
  verified token
- Forwarding any other decoded JWT claim to backends as a custom header — `X-User-Id` is the only
  identity header; adding more is a design decision, not an incidental addition

## JWT Verification

- `jwt.verify(token, publicKey, { algorithms: ['RS256'] })` — the `algorithms` option is **not
  optional in practice**. Omitting it is the classic "alg confusion" vulnerability: a token signed
  with `alg: none`, or HS256 using the RS256 public key as an HMAC secret, would otherwise validate.
  Any new or modified verify call must keep this pinned.
- This gateway only ever verifies. There is no signing key anywhere in this codebase, and there
  should never be one — token issuance is the Auth service's responsibility.

## Environment Variable Management

Boot-time env vars (`CONFIG_SERVER_URL`, `PROFILE`, `INSTANCE_HOSTNAME`, `INSTANCE_IP_ADDR`,
`PORT`) are read from `process.env` only inside `src/bootstrap/env.ts`. Guards, services, and
controllers read config through `GatewayConfigService`, never `process.env` directly.

## Config Server Response Handling

- The fetched payload is trusted infrastructure input (from an internal Config Server), not
  end-user input — `gateway-config.validate.ts` checks shape, not content, and that's intentional.
- Never log the raw Config Server response body (it contains the JWT public key and, depending on
  future fields, could contain other sensitive values).
- A fetch failure (network error or a non-2xx status, including the Config Server's own 404/503)
  must fail the boot (`process.exit(1)`) — never fall back to a stale or hardcoded config for
  `jwt.publicKey` or `eureka.serviceUrl`.

## Identity Header (`X-User-Id`)

- `JwtAuthGuard` deletes any incoming `X-User-Id` at the very start of every request (public paths
  included), then sets it from the verified token's `sub` claim (`src/auth/user-id.ts`). This is
  what stops a client from impersonating a user by sending the header itself — do not move the
  deletion after the public-path check or make it conditional.
- A token that verifies but has no usable `sub` is rejected with 401, never forwarded without an
  identity.
- Public paths never get `X-User-Id` (no verification happens there). Backends must treat a
  missing `X-User-Id` as unauthenticated.
- The original `Authorization` header is still forwarded unmodified.

## Metrics

- The metrics listener is separate from the public one and binds `METRICS_HOST` (default
  `127.0.0.1`). Do not default it to `0.0.0.0`: a gateway started directly on a VM would expose it
  on an external interface.
- Trade-off to keep documented: a Prometheus running in Docker on **Linux** cannot reach a
  loopback-bound port through `host-gateway`. Set `METRICS_HOST` to a private interface IP (or
  `0.0.0.0` behind a firewall / inside a private container network where the port is not published).
  Docker Desktop (macOS/Windows) reaches loopback through `host.docker.internal`.
- Never put a JWT, key, user id, or raw request path in a metric label or HELP text.
- The local Grafana and Prometheus are published on `127.0.0.1` only; `GRAFANA_ADMIN_PASSWORD` is
  for local use and must not be reused anywhere real.

## Proxying

- Do not strip, rewrite, or duplicate the `Authorization` header — backends still receive it as-is.
- Do not log full request/response bodies passing through the proxy in production — they may
  contain participant PII (this is a public-facing registration system).

## Error Messages to Clients

- Do not expose internal details (Eureka server address, raw network error strings, Config Server
  URL) in a response body sent to the client. Log detail server-side; respond with a generic
  message (`{ message: 'Bad Gateway' }` / `{ message: 'Service Unavailable' }`, matching the
  existing pattern in `proxy.controller.ts`).

## Logging

- Never log a JWT (valid or invalid), a public/private key, or the Config Server response body.
- Use structured logging (JSON) if logging is expanded beyond the current `Logger` calls in
  `bootstrap/run.ts`.
