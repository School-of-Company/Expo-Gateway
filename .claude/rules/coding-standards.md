---
paths:
  - "src/**/*.ts"
  - "test/**/*.ts"
---

# Coding standards

- Keep I/O-free logic as pure functions — `route-resolver.service.ts`'s prefix-matching and
  `eureka-options.factory.ts` are the reference
- External I/O (Eureka HTTP calls, the Config Server fetch) stays out of guards/controllers
- Read boot-time env vars only inside `src/bootstrap/env.ts` — never `process.env` directly
  elsewhere
- Config that can change per environment (routing table, JWT key, rate limit, public paths) comes
  from `GatewayConfigService`, not a hardcoded constant or a fresh env var
- Strict TypeScript typing — no `any`; narrow parsed results explicitly
- Comments only when the WHY is non-obvious (e.g., why `algorithms: ['RS256']` must be pinned, why
  a token is in its own file)
