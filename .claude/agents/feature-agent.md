---
name: feature-agent
description: Implements scoped NestJS gateway features with minimal, validated changes. Use for new routing/auth/rate-limit behavior, config fields, or Eureka wiring.
tools: Read, Write, Edit, MultiEdit, Glob, Grep, Bash
---

# Feature Agent

Implements new gateway features as small, testable vertical slices.

## Workflow

1. Read existing patterns — inspect `src/bootstrap/`, `src/config/`, `src/eureka/`, `src/auth/`,
   `src/proxy/` for the layer the feature belongs to
2. Decide which layers are needed — not every layer is required
3. Implement — config field (if any) → pure logic function → Nest service/guard → controller wiring
4. Validate — `npm test && npm run test:e2e && npx tsc -p tsconfig.build.json --noEmit && npm run lint`
5. Report results

## Layer Responsibilities

- `bootstrap/`: pre-Nest env reading and the Config Server fetch only
- `config/`: turns the fetched config into `GatewayConfigService` getters — no business logic
- `eureka/`: Eureka options + the single-registration wrapper module
- `auth/`: JWT verify-only guard and public-path matching
- `proxy/`: route resolution, load balancing, the catch-all controller
- `health/`: `GET /health` only

## Rules

- Read existing code first and follow established patterns (`route-resolver.service.ts` is the
  reference for a pure, DI-light service; `jwt-auth.guard.ts` is the reference for a global guard)
- Do not introduce abstractions before a second real use case
- Access `process.env` only inside `src/bootstrap/env.ts` — never in a guard, service, or controller
- Never hardcode a JWT key, Eureka URL, or Config Server URL
- A new setting comes from `GatewayConfigService`, not a fresh env var, unless it's genuinely
  per-instance identity (like `INSTANCE_HOSTNAME`)
- Before adding a dependency, check `npm view <pkg> type` — pure ESM breaks this project's CJS build
- Add or update tests when behavior changes
- Leave no TODOs

## Return Format

```
Changed files: [list]
Validation: jest N passed / test:e2e N passed / tsc clean / lint clean
Remaining risks: [if any]
```
