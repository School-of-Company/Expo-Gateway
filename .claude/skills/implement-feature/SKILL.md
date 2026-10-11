# Implement Feature

## Steps

1. **Understand** — Read related existing files. Check which of `bootstrap/`, `config/`, `eureka/`,
   `auth/`, `proxy/`, `health/` the feature belongs to (see `.claude/rules/architecture.md`).
2. **Plan** — List which files to create or modify.
3. **Config first (if the feature needs a new setting)** — add the field to
   `GatewayConfig` (`src/bootstrap/gateway-config.types.ts`), validate it in
   `parseGatewayConfig` (`src/bootstrap/gateway-config.validate.ts`), expose a typed getter on
   `GatewayConfigService`, and add an in-repo default in `gateway-config.defaults.ts` only if the
   field has a genuinely safe fallback (rate-limit — not a key, a discovery URL, or the routing table).
4. **Implement as a pure function where possible** — anything that doesn't need DI
   (`route-resolver`'s prefix-matching logic, `eureka-options.factory`, `public-path.matcher`)
   should be a plain exported function, unit-testable without Nest.
5. **Wire the Nest layer** — service/guard/controller as needed. Global cross-cutting concerns
   (auth, rate limiting) go through `APP_GUARD` in `app.module.ts`, not `app.useGlobalGuards()`
   (which skips DI).
6. **Write tests** — unit tests for the pure logic and any new service/guard, e2e test if it
   changes observable HTTP behavior (see `write-test` skill).
7. **Validate** — `npm test && npm run test:e2e && npx tsc -p tsconfig.build.json --noEmit && npm run lint`
8. **Report** — Changed files, validation result, remaining risks.

## Notes

- Follow existing patterns. Explain if introducing a new pattern.
- Access `process.env` only inside `src/bootstrap/env.ts` — never in a guard, service, or
  controller.
- If the new provider needs a value that's only known after the boot-time Config Server fetch,
  wire it through `GATEWAY_CONFIG`/`GatewayConfigService` (`forRootAsync` + `useFactory`), not a
  fresh ad-hoc singleton — see `.claude/rules/architecture.md`'s Bootstrap Sequence section for why.
- If the feature needs a new external service client library, check `npm view <pkg> type` before
  adding it — a pure-ESM dependency breaks this project's CommonJS build (see `fix-bug` skill).
- Do not introduce a shared abstraction across modules before a second real use case exists.
