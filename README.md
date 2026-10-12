<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Gateway configuration

### SMS rate limiting

Gateway accepts an optional `rateLimit.sms` policy from Config Server:

```yaml
rateLimit:
  ttlSeconds: 60
  limit: 100
  sms:
    ttlSeconds: 60
    limit: 10
```

The SMS budget applies to `/sms` and `/sms/...`, shared across methods and
paths for each client IP. The global budget still applies. Exceeding either
budget returns HTTP 429 before JWT verification; SMS rejection includes
`Retry-After-sms`. SMS values must be positive safe integers. Omitting `sms`
keeps the existing global policy.

An optional `rateLimit.survey` policy (same shape as `sms`) budgets only
`POST /surveys/answer/public/...` per client IP, so the public survey submit can
be limited without throttling the survey page (`GET /surveys/public/...`).
Exceeding it returns HTTP 429 with `Retry-After-survey`. Pick the value with
shared booth IPs in mind: many devices behind one address share the budget.

Limits use the existing in-memory throttler storage per Gateway instance and
reset on restart. The deployment must restrict direct Gateway access and
forward client IPs through the trusted proxy. Notification Server's Redis
limits remain separate.

Public SMS methods and profile settings belong to
[Config Server #26](https://github.com/School-of-Company/Expo-Config-Server/issues/26).
Adding this Gateway capability alone does not enable the SMS policy or make
SMS endpoints public.

### Participant browser flows (cookies, CORS, CSRF)

Participant phone auth (User Server `/participant-auth/**`, Gateway #25) and the
Application participant APIs (Gateway #29) authenticate with the HttpOnly
`PARTICIPANT_SESSION` cookie, not a JWT. Gateway support:

- **Dynamic public paths.** A method-qualified `publicPaths` entry may use
  whole-segment placeholders, e.g.
  `POST /application/expos/{expoId}/my-applications/{type:PREREGISTER|STANDARD|TRAINING}/{applicationId}/cancellation`.
  `{name}` matches one id (a decimal number or a UUID); `{name:A|B}` matches
  exactly one listed value. An arbitrary word never matches, so
  `POST /application/{expoId}` does not open `POST /application/admin`. The
  method, the segment count and every literal segment must match; `.`/`..`,
  `%`-encoded and `;` values never match. Plain (`/prefix`) entries cannot use braces.
- **Pass-through.** `Cookie` (`PARTICIPANT_SESSION`, `JSESSIONID`,
  `XSRF-TOKEN`), every `Set-Cookie` with its attributes, `X-CSRF-TOKEN`,
  `X-XSRF-TOKEN`, `Idempotency-Key` and upstream status codes/bodies
  (401/403/409/429/503 ...) are forwarded unchanged. The gateway never rewrites
  cookie `Domain`/`Path`; User Server owns them via `PARTICIPANT_SESSION_COOKIE_*`.
- **Internal APIs are never exposed.** Any path with an `internal` segment, or a
  `.`/`..` segment, after percent-decoding (`/internal/**`, `/x/..%2finternal`,
  `/%69nternal`) returns 404 without being forwarded, even if a routing prefix
  would match and even with a valid JWT (without a JWT a protected path still
  answers 401 first). A path whose percent-encoding cannot be decoded (`/a/100%`)
  is answered 404 the same way. A client-sent `X-Internal-Token` is removed
  before proxying.
- **Credentialed CORS** (optional, off when absent):

  ```yaml
  cors:
    allowedOrigins:
      - https://expo.example.com   # exact scheme://host[:port], no "*", no path
  ```

  An allowed `Origin` is echoed with `Access-Control-Allow-Credentials: true`
  and `Vary: Origin`; preflights are answered by the gateway (204, methods
  `GET POST PUT PATCH DELETE`, headers `Authorization Content-Type X-CSRF-TOKEN
  X-XSRF-TOKEN Idempotency-Key`, max-age 600) and never reach a backend;
  `X-CSRF-TOKEN` is exposed to the page. Upstream `Access-Control-*` headers are
  dropped so the gateway is the single CORS owner. Invalid origins fail boot.
- **CSRF (gateway half).** With `cors` set, a POST/PUT/PATCH/DELETE whose
  `Origin` is present but not allowed gets 403 before it is forwarded or
  rate-limited. Requests without `Origin` (a server-side BFF, curl) pass.
  Same-origin pages served by the gateway itself (the `/docs` "Try it out")
  also send `Origin`, so list the gateway's own origin too if that is used.
  Backends keep their own checks: Application requires `X-CSRF-TOKEN` +
  `JSESSIONID` (my-applications cancel) or `X-XSRF-TOKEN` + `XSRF-TOKEN`
  (program sessions). The `PARTICIPANT_SESSION` cookie should stay
  `SameSite=Lax` while the front and API are same-site; cross-site needs
  `SameSite=None; Secure` plus this Origin check.
- **SMS abuse.** `rateLimit.participantAuthCode` (same shape as `survey`)
  budgets `POST /participant-auth/code` per client IP (encoded / `;` variants
  included) and returns 429 with `Retry-After-participantAuthCode` (exposed to
  allowed origins). The per-phone-number limit belongs to
  User Server / Notification Server (the gateway never reads bodies).

The public path list, the `/participant-auth` routing prefix, `cors` and
`participantAuthCode` values live in Config Server `gateway-{profile}.yml`; this
gateway change alone opens nothing.

### Integrated API docs (`/docs`)

An optional `docs` section turns on one Swagger UI page that lists every
service's OpenAPI document in a dropdown. It is off unless `docs.enabled` is
`true`; when off (or absent) `/docs` is not served and nothing else changes.

```yaml
docs:
  enabled: true
  title: Expo API 문서   # optional, default "API 문서"
  services:
    - name: 참여
      url: /attendance/v3/api-docs
```

- `services` is required when enabled: 1 to 30 entries of `{name, url}`. `name`
  is a non-empty string; `url` must be a gateway path starting with `/` (no
  `//`, scheme, host, backslash or whitespace), so it can never point at an
  external host. An invalid section fails boot validation.
- The gateway serves the page itself (`GET /docs`, `/docs/config.json`,
  `/docs/swagger-initializer.js`, `/docs/assets/*` from the `swagger-ui-dist`
  package), with no CDN, so it works offline. Service values reach the page only
  as JSON from `/docs/config.json`; nothing is interpolated into HTML or script.
- `GET`/`HEAD` on `/docs` and below skip JWT only while `docs.enabled` is true.
  Every other path keeps its current rules, and `/docs` is never proxied.
  A `docs` section with `enabled: false` leaves `/docs` as an ordinary unknown
  path (401 without a token, 404 with one, as before).
- Docs requests share the default per-IP rate limit; there is no separate budget.
  A `GET` of a URL listed in `docs.services` (e.g. `/sms/v3/api-docs`) does not
  spend the `rateLimit.sms` budget, which is meant for sending SMS.
- "Try it out" always calls the gateway origin the page was loaded from, even
  when a service's OpenAPI `servers` holds its own instance address (springdoc
  builds it from the proxied `Host`). Calls therefore go through JWT, routing
  and the Origin check, and an `Authorize` token never leaves the gateway.
  Spec and external `$ref` fetches are not rewritten; OAuth2 token URLs are not
  supported (every service uses a bearer JWT).
  Browsers send `Origin` on same-origin writes too: while `cors` is set, add the
  gateway's own origin to `cors.allowedOrigins` or POST/PUT/PATCH/DELETE from
  `/docs` get 403 (GET still works).
  The Authorize button only appears for documents that declare a security
  scheme (e.g. `bearerAuth`).

#### Docs-only Basic auth (production)

Without `docs.basicAuth` the page and the listed OpenAPI documents are open as
described above (dev). For an environment that must not show them to everyone,
set a docs-only HTTP Basic credential and the gateway asks for it instead of a JWT:

```yaml
docs:
  enabled: true
  requireAuth: true     # boot fails if basicAuth is missing (e.g. a missing Vault secret)
  tryItOut: false       # hide "Try it out" so docs cannot change real data
  # basicAuth comes from Vault (secret/gateway), never from the yml file:
  #   docs.basicAuth.username / docs.basicAuth.password (password 12-128 chars)
```

- With `basicAuth` set, `GET`/`HEAD` on `/docs` and below **and** on every
  `docs.services[].url` need `Authorization: Basic ...`; otherwise 401 with
  `WWW-Authenticate: Basic realm="docs"` (the browser shows its login box) and no
  document content. A JWT does not open them and a docs credential opens nothing
  else. A service document needs no `publicPaths` entry then, and one that is
  listed there is still protected.
- The `Authorization` header is removed before the request reaches the service,
  so the docs credential is never forwarded. Credentials are compared in
  constant time and never logged or put in error messages.
- `requireAuth: true` without `basicAuth` fails boot (the gateway's usual
  fail-fast), so a missing Vault entry cannot leave the docs open. Keep
  `requireAuth: false` (the default) in dev.
- The page works under a public path prefix such as `/expo`: it derives its base
  path from the address it was loaded from (`/expo/docs` loads `/expo/docs/...`,
  and service documents are fetched from `/expo/<prefix>/v3/api-docs`). The
  reverse proxy in front of the gateway must strip that prefix.
- Browsers cache Basic credentials per origin and realm, so the service-document
  requests that the page makes are expected to reuse them; if a browser asks
  again for each service, that is the browser, not the gateway.
- "Try it out" requests are rewritten to the gateway origin only; under a path
  prefix they do not get the prefix added. That is acceptable while `tryItOut`
  is `false`.
- The credential is a single shared value; rotate it in Vault and restart the
  gateway. Docs requests share the per-IP rate limit, which also limits guessing.

Path convention: each service serves its OpenAPI JSON under its own gateway
prefix as `/{prefix}/v3/api-docs` (for example `/attendance/v3/api-docs`).
The gateway proxies it like any request; it does not rewrite paths.
The service documents are **not** opened by gateway code. Add a
method-qualified entry per document to `publicPaths` in Config Server, for
example `GET /attendance/v3/api-docs` (a method-qualified entry opens exactly
that path, not its sub-paths).

To add a service: have it expose `/{prefix}/v3/api-docs`, add
`GET /{prefix}/v3/api-docs` to `publicPaths`, and append `{name, url}` to
`docs.services`, all in the same Config Server profile file.

Exposure warning: this page and the public OpenAPI paths show every service's
API surface to anyone who can reach the gateway. Enable it in the dev profile
only; leave `docs` out of production unless the exposure is a deliberate decision.

### Shared monitoring responsibilities

Gateway keeps its `gateway_http_*` metrics, dedicated metrics listener and
local monitoring stack. Eureka advertises `prometheus.scrape`,
`prometheus.port` and `prometheus.path` only after the metrics listener binds
successfully and is reachable through the registered instance address.
This is implemented by [PR #19](https://github.com/School-of-Company/Expo-Gateway/pull/19).

Shared recording rules, dashboards and staging scrape verification belong to
[Monitoring #3](https://github.com/School-of-Company/Expo-Monitoring/issues/3).
Common exporter conventions belong to
[Config Server #8](https://github.com/School-of-Company/Expo-Config-Server/issues/8).
The Gateway-local dashboard uses its dedicated Prometheus; the shared stack
must scope runtime queries to Gateway to avoid mixing other services.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

GitHub Actions (`.github/workflows/deploy.yml`) runs tests and the build for
pull requests into `develop` or `main` without packaging, SSH credentials or
remote deployment. **Only a push to `main` deploys** (or a manual
`workflow_dispatch` on `main`); merging into `develop` deploys nothing. The
server is a single environment, so there is no separate dev deployment.
Documentation, `.claude/`, local monitoring and `docker-compose.yml` changes do
not trigger a push deploy.

Configure repository variables `EXPO_SSH_HOST`, `EXPO_SSH_PORT` and
`EXPO_SSH_USER`, plus secrets `EXPO_SSH_KEY` and `EXPO_SSH_KNOWN_HOSTS`. The
remote root is fixed in the workflow; it must be absolute and contain no
whitespace or shell metacharacters. Missing deployment settings stop the job
before installation.
The SSH target's Node must match the runner's platform, architecture, Node ABI
and libc version before the bundled `node_modules` is uploaded. A mismatch
stops deployment before release upload. Run the workflow regression check with
`node test/deploy-workflow.check.cjs` after `npm ci`.

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
