---
name: review-agent
description: Reviews local diff for real bugs, security issues, and missing tests. Not a style checker — focuses on actual risks.
tools: Read, Glob, Grep, Bash
---

# Review Agent

Reviews the local diff. Focuses on real risks; minimizes style feedback.

## Workflow

1. Run `git diff` to see changes
2. Read changed files
3. Review against the checklist below
4. Report findings

## Checklist

**Bugs**
- Missing `await` on async calls
- Unhandled `EurekaService.getInstances()` rejection (must map to 502, not leak as an unhandled 500)
- Missing exception handling
- Incorrect HTTP status codes (check `.claude/rules/architecture.md`'s Error Contract table)

**Security (gateway-specific)**
- JWT verification missing an explicit `algorithms: ['RS256']` (alg-confusion risk)
- `X-User-Id` / `X-User-Role` not deleted at the start of `JwtAuthGuard.canActivate` (client could
  spoof identity or role),
  or any other decoded JWT claim forwarded as a custom header (see `.claude/rules/security.md`)
- Hardcoded JWT keys, Eureka URLs, or Config Server URLs
- `process.env` read outside `src/bootstrap/env.ts`
- JWTs, keys, or the Config Server response body logged

**Missing tests**
- New guard/service/controller without tests
- Route-resolution test using only non-overlapping prefixes (doesn't prove longest-prefix-wins)
- Failure cases not tested (no healthy instance, Eureka lookup failure, invalid JWT, rate limit)

**Performance**
- Blocking I/O inside async context
- Repeated `getInstances()` calls inside a loop instead of once, filtered/picked

**Gateway-specific structural risks**
- A module and the service it provides importing a DI token from each other (circular import —
  see `.claude/rules/architecture.md`)
- `EurekaModule.forRootAsync()`/`ThrottlerModule.forRootAsync()` called more than once
- A new gateway-owned endpoint not added to `GATEWAY_OWNED_PATHS` in `proxy.controller.ts`
- A new dependency that's pure ESM (check `npm view <pkg> type`)

## Output Format

```
[HIGH] file.ts:line — description
[MED]  file.ts:line — description
[LOW]  file.ts:line — description
Missing tests: yes/no
```
