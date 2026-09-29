# Write Test

## Steps

1. **Understand** — Read the code under test. Identify inputs, outputs, and side effects (Eureka HTTP calls, Config Server fetch, JWT verification).
2. **Check existing patterns** — See how sibling `*.spec.ts` files in the same directory set up mocks, and `test/support/gateway-test-app.ts` for the e2e helper.
3. **Write cases** — Happy path → error cases (401/502/503/429 where applicable) → edge cases.
4. **Isolate external deps** — Mock `global.fetch` (Config Server), or mock the collaborator class directly with `jest.fn()`/a cast object (`EurekaService`, `GatewayConfigService`).
5. **Run** — `npm test -- src/<path>/<file>.spec.ts`

## Unit Test Pattern (direct instantiation, mocked dependency)

Prefer direct instantiation over `Test.createTestingModule` for a single class under test — it's
faster and the dependency graph here is small enough not to need the DI container.

```ts
const gatewayConfig = {
  getRouting: () => routing,
} as unknown as GatewayConfigService;

const resolver = new RouteResolverService(gatewayConfig);
```

```ts
const eureka = {
  getInstances: jest.fn().mockResolvedValue(instances),
} as unknown as EurekaService;

const lb = new LoadBalancerService(eureka);
```

## JWT Test Fixtures

Always generate a real RSA keypair per test file — never hardcode a PEM string:

```ts
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
```

When testing a "tampered signature" case, flip a character well before the end of the token, not
the last character — the last base64url character of a JWT can encode only unused padding bits and
may not change the decoded signature bytes at all, making the test flaky.

Always include an alg-confusion case: sign a token with `HS256` using the RS256 public key as the
HMAC secret, and assert it's rejected. This is what actually proves `algorithms: ['RS256']` is
pinned in the verify call, not just that verification happens at all.

## e2e Pattern (real AppModule + supertest)

Use the shared helper — it wires the Config Server bootstrap singleton, sets the required instance
env vars, and overrides `EurekaService` so no test hits a real Eureka or Config Server:

```ts
const app = await createTestApp({
  gatewayConfig: { jwt: { publicKey }, eureka: { serviceUrl: 'http://unused:8761/eureka' }, ... },
  eurekaInstances: [instance({ ipAddr: '127.0.0.1', port: stubPort })],
});

const res = await request(getHttpServer(app)).get('/v1/forms/123');
```

- For proxy tests, spin up a real `http.createServer(...)` on an ephemeral port as the stub
  upstream — `http-proxy-middleware` does real network I/O, so there's no clean way to mock it at
  the request layer.
- `getHttpServer(app)` (not `app.getHttpServer()` directly) — the latter is typed `any` and trips
  `no-unsafe-*` lint rules; the helper casts it to `net.Server` once.
- Clean up with `await app.close()` in `afterEach`, and call `resetGatewayConfigForTests()` (done
  inside `createTestApp`) before each test — the gateway config singleton is a module-scope global,
  not DI-scoped, so it leaks across tests otherwise.

## Notes

- Each test must be runnable independently.
- Always test the failure paths, not just the happy path: no healthy instance (503), Eureka lookup
  failure (502), missing/expired/invalid/alg-confused JWT (401), rate limit exceeded (429), config
  fetch failure at boot (`exit(1)`, `NestFactory.create` never called).
- When testing route resolution with overlapping prefixes (e.g. `/v1/forms` and
  `/v1/forms/special`), assert the longest-prefix-wins case specifically — a test with only
  non-overlapping prefixes doesn't prove that logic works.
