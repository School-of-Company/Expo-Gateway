# Gateway Security Rules

## Strictly Forbidden

- Reading or printing `.env`, `.env.*` files (`.env.example` is fine — it's a template with no
  real values)
- Printing a JWT signing/public key, a raw Bearer token, or the Config Server response body in logs
- Hardcoding a JWT key, Eureka URL, or Config Server URL in code — these come from
  `GatewayConfigService`/`src/bootstrap/env.ts` only
- Committing a real PEM key or `.p8`/`.pem` file into this repo
- Letting a client-supplied `X-User-Id` or `X-User-Role` reach a backend — only `JwtAuthGuard` may
  set them, from a verified token
- Forwarding any other decoded JWT claim to backends as a custom header — `X-User-Id` and
  `X-User-Role` are the only identity headers; adding more is a design decision, not an incidental
  addition

## JWT Verification

- `jwt.verify(token, publicKey, { algorithms: ['RS256'] })` — the `algorithms` option is **not
  optional in practice**. Omitting it is the classic "alg confusion" vulnerability: a token signed
  with `alg: none`, or HS256 using the RS256 public key as an HMAC secret, would otherwise validate.
  Any new or modified verify call must keep this pinned.
- This gateway only ever verifies. There is no signing key anywhere in this codebase, and there
  should never be one — token issuance is the Auth service's responsibility.

## Environment Variable Management

Boot-time env vars (`CONFIG_SERVER_URL`, `CONFIG_SERVER_PASSWORD`, `PROFILE`, `INSTANCE_HOSTNAME`,
`INSTANCE_IP_ADDR`, `PORT`) are read from `process.env` only inside `src/bootstrap/env.ts`. Guards, services, and
controllers read config through `GatewayConfigService`, never `process.env` directly.

`CONFIG_SERVER_PASSWORD` (optional) is sent to the Config Server as HTTP Basic auth with the
username `gateway` (Expo-Config-Server#54). Never log it, put it in `CONFIG_SERVER_URL`
(`user:pass@host` — Node `fetch` rejects credentials in URLs and the URL is echoed in errors), or
commit it.

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

## Role Header (`X-User-Role`)

- Same rule as `X-User-Id`: `JwtAuthGuard` deletes any incoming `X-User-Role` at the very start of
  every request (public paths included) and only then sets it from the verified token's `role`
  claim (`src/auth/user-role.ts`).
- A token without a usable `role` is still accepted — the header is simply absent. Backends must
  treat a missing `X-User-Role` as "no role", never as a default role.
- The value is forwarded only if it is a plain role name (`[A-Za-z0-9_.:-]`, max 64 chars); anything
  else is dropped so a crafted claim cannot inject header content.
- The role is the one baked into the token at issue time; a role change takes effect after re-login.

## Public Paths

- `publicPaths` entries are `"/path"` (any method, prefix match) or `"METHOD /path"` (that method and
  that exact path only). Prefer the method-qualified form: it opens one endpoint, so a protected
  endpoint added under the same prefix later does not become public by accident.
- A path can mix public and protected methods (e.g. `POST /auth` public, `DELETE /auth` protected).
  The protected method goes through normal verification and receives `X-User-Id`.
- A method-qualified entry may use whole-segment placeholders: `{name}` (decimal or UUID id) and
  `{name:A|B}` (one listed value).
- A malformed entry (unknown or lowercase method, stray whitespace, braces outside a whole
  `{name}` segment or on a plain entry) fails config validation at boot.

## Internal APIs, CORS and CSRF

- `/internal/**` endpoints are service-to-service (guarded by `X-Internal-Token`). The gateway
  answers 404 for any path with an `internal`, `.` or `..` segment after percent-decoding and
  strips a client-sent `X-Internal-Token` — regardless of the routing table. Do not weaken
  `proxy/blocked-paths.ts` to route one.
- `cors.allowedOrigins` holds exact origins only; never `*`, never reflect an arbitrary `Origin`
  with `Allow-Credentials`. While `cors` is set the gateway is the single CORS owner and drops
  upstream `Access-Control-*` headers.
- A state-changing request with a non-allowed `Origin` is rejected (403) before forwarding. Adding
  a header to `CORS_ALLOWED_HEADERS` is an API decision, not an incidental change.
- Public-path placeholders: `{name}` matches only a decimal number or UUID, `{name:A|B}` only a
  listed value. Never widen them to arbitrary words — that would open same-depth siblings
  (`POST /application/admin` via `POST /application/{expoId}`).

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

## Client IP (`trust proxy`)

- `trust proxy` is `['loopback', ...trustedProxies]` (`bootstrap/trust-proxy.ts`), never a hop
  count or `true`: `/expo/` is reachable through Apache directly, so a count would turn a forged
  `X-Forwarded-For` into `req.ip` and let a client dodge every IP budget.
- `trustedProxies` holds specific hosts (IPv4 `/24`+, IPv6 `/64`+); do not loosen the validation
  to accept wide ranges or names. Do not add a production IP without evidence it is fixed.
- The BFF (Vercel, no fixed IP) is trusted by `X-Bff-Token` = `bff.token` (Vault, constant-time
  compare via `proxy/client-ip.ts`), never by IP. Only then does the rate-limit key move one
  `X-Forwarded-For` entry left of `req.ip`; it never changes `req.ip` itself or anything but the
  throttler key. The header is stripped before forwarding, and the token is never logged or put in
  an error message.
