# Review Local Diff

## Steps

1. `git diff` — see current changes.
2. `git diff --name-only` — list changed files.
3. Read each file — understand the context before and after.
4. Review against criteria below.
5. Report findings.

## General Review Criteria

**Bugs (must check)**
- Missing `await` on async calls
- Unhandled `fetch`/`getInstances()` rejection (must map to the right status code, not leak as an unhandled 500)
- Missing exception handling
- Incorrect HTTP status codes

**Security**
- JWT verification missing an explicit `algorithms: ['RS256']` — omitting it is the classic alg-confusion vulnerability (a token signed with `alg: none` or HS256-using-the-public-key-as-secret would otherwise validate)
- Hardcoded secrets, JWT keys, or Eureka/Config Server URLs
- Authorization headers, JWT contents, or the Config Server response body logged
- A new dependency that reads `process.env` outside `src/bootstrap/env.ts`

**Missing tests**
- New guard/service/controller without tests
- Failure cases not tested (no healthy instance, Eureka lookup failure, invalid/expired/wrong-alg JWT, rate limit exceeded)
- Route-resolution tests with non-overlapping prefixes (doesn't prove longest-prefix-wins actually works)

**Performance**
- Blocking I/O inside async context
- Repeated Eureka `getInstances()` calls inside a loop (should be one call, then filter/pick)

## Gateway-Specific Review Criteria

**Circular imports**
- A module (`*.module.ts`) and the service it provides (`*.service.ts`) importing a DI token from
  each other, instead of both importing it from a dedicated tokens file, silently makes `@Inject()`
  capture `undefined` on whichever side of the cycle loads second — this has happened once already
  in this repo (`gateway-config.module.ts` ↔ `gateway-config.service.ts`, fixed by extracting
  `gateway-config.tokens.ts`). Check any new provide/inject pair for the same pattern.

**Dynamic module re-registration**
- `EurekaModule.forRootAsync()` (and similarly `ThrottlerModule.forRootAsync()`) must be called
  exactly once in the whole app — calling it a second time from a different module starts a second,
  independent registration/heartbeat loop. New code needing `EurekaService` should import
  `EurekaClientModule`, not call `EurekaModule.forRootAsync()` again.

**Config-driven vs. hardcoded**
- Routing table, JWT public key, rate-limit thresholds, and the public-path bypass list must come
  from the boot-time Config Server payload (`GatewayConfigService`), not be hardcoded in a
  controller/guard/service. `src/config/gateway-config.defaults.ts` is the only place a fallback
  constant belongs, and only for fields that have a genuinely safe default (routing, rate limit —
  not `jwt.publicKey` or `eureka.serviceUrl`).

**ESM/CJS**
- A new or upgraded dependency that ships pure ESM (`"type": "module"`, no CJS `main`) breaks
  `require()` under this project's CommonJS build and Jest config. Check `npm view <pkg> type`
  before adding one; `http-proxy-middleware` is deliberately pinned to `3.0.7` (CJS) instead of the
  latest `4.x` (pure ESM) for exactly this reason.

**Catch-all route ordering**
- The proxy controller's `@All('/{*splat}')` matches every path, including this gateway's own
  endpoints (e.g. `/health`) — any new gateway-owned endpoint must be added to
  `GATEWAY_OWNED_PATHS` in `proxy.controller.ts` (and call `next()`) rather than relying on Nest's
  controller registration order to put it "before" the catch-all.

## Output Format

```
[HIGH] file.ts:line — description
[MED]  file.ts:line — description
[LOW]  file.ts:line — description
Gateway-specific issues: [if any]
Missing tests: yes/no
```

Style issues are handled by eslint. Do not duplicate.
