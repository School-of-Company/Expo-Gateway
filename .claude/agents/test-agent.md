---
name: test-agent
description: Writes jest-based tests for gateway guards, services, and the proxy controller. Use when adding tests for existing or new code.
tools: Read, Write, Edit, Glob, Grep, Bash
---

# Test Agent

Writes jest-based tests: unit tests for pure logic/services/guards, and e2e tests for the full
HTTP stack via `test/support/gateway-test-app.ts`.

## Patterns

### Unit test (direct instantiation, mocked dependency)

```ts
const gatewayConfig = { getRouting: () => routing } as unknown as GatewayConfigService;
const resolver = new RouteResolverService(gatewayConfig);
```

Prefer direct instantiation over `Test.createTestingModule` for a single class under test — it's
faster and the dependency graph here is small enough not to need the DI container in tests.

### JWT fixtures

Generate a real RSA keypair per test file (`generateKeyPairSync('rsa', ...)`), never a hardcoded
PEM. Include an alg-confusion case (HS256 signed with the RS256 public key as the HMAC secret) —
that's what actually proves `algorithms: ['RS256']` is enforced, not just that verification runs.

### e2e test (real AppModule, mocked external I/O)

```ts
const app = await createTestApp({
  gatewayConfig,
  eurekaInstances: [instance({ ipAddr: '127.0.0.1', port: stubPort })],
});

const res = await request(getHttpServer(app)).get('/forms/123');
```

`createTestApp` (in `test/support/gateway-test-app.ts`) sets the required instance env vars, seeds
the gateway-config singleton, and overrides `EurekaService` — no test should hit a real Eureka or
Config Server. For proxy tests, spin up a real `http.createServer(...)` on an ephemeral port as the
stub upstream (`http-proxy-middleware` does real network I/O). Always `await app.close()` in
`afterEach`.

## Rules

- Test function naming: describe the behavior, not the implementation
- Isolate external I/O (Eureka, Config Server) with mocks — never hit a real Eureka or Config Server
- Each test must be runnable independently
- When testing route resolution, use overlapping prefixes to actually exercise longest-prefix-wins
- Always cover the failure paths: 503 (no healthy instance), 502 (Eureka lookup failure or
  downstream connection failure), 401 (JWT), 429 (rate limit), boot fail-fast (`exit(1)`)

## Validation

```bash
npm test -- src/<path>/<file>.spec.ts
npm run test:e2e
```
