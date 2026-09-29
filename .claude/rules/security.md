# Gateway Security Rules

## Strictly Forbidden

- Reading or printing `.env`, `.env.*` files (`.env.example` is fine — it's a template with no
  real values)
- Printing a JWT signing/public key, a raw Bearer token, or the Config Server response body in logs
- Hardcoding a JWT key, Eureka URL, or Config Server URL in code — these come from
  `GatewayConfigService`/`src/bootstrap/env.ts` only
- Committing a real PEM key or `.p8`/`.pem` file into this repo
- Forwarding decoded JWT claims to backend services as custom headers (e.g. `X-User-Id`) — v1's
  design assumes each backend service independently re-verifies the JWT with the same shared
  public key; only the original `Authorization` header is passed through unmodified. If this needs
  to change, treat it as a real design decision, not an incidental addition — flag it for design
  review rather than adding it inline.

## JWT Verification

- `jwt.verify(token, publicKey, { algorithms: ['RS256'] })` — the `algorithms` option is **not
  optional in practice**. Omitting it is the classic "alg confusion" vulnerability: a token signed
  with `alg: none`, or HS256 using the RS256 public key as an HMAC secret, would otherwise validate.
  Any new or modified verify call must keep this pinned.
- This gateway only ever verifies. There is no signing key anywhere in this codebase, and there
  should never be one — token issuance is `expo-expo-server`'s `/auth` responsibility.

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

## Proxying

- The gateway forwards the original `Authorization` header unmodified — do not strip, rewrite, or
  duplicate it into another header without a deliberate design reason (see Strictly Forbidden
  above).
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
