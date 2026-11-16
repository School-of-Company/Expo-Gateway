---
paths:
  - "**"
---

# Workflow

## Validation Commands

```bash
# Required
npm test                # Unit tests (jest)
npm run test:e2e        # e2e tests (real HTTP stack, stub Eureka/upstream)

# Recommended
npx tsc -p tsconfig.build.json --noEmit   # Type check
npm run lint             # eslint

# Run
npm run start:dev

# Local monitoring (Prometheus + Grafana)
docker compose up -d      # Grafana http://127.0.0.1:3001, Prometheus http://127.0.0.1:9090
docker compose down       # never add -v (volumes keep the dashboards' history)
```

## Agent Routing

| Task                  | Agent            |
| --------------------- | ---------------- |
| Add new feature       | `feature-agent`  |
| Fix a bug             | `fix-agent`      |
| Write tests           | `test-agent`     |
| Code review           | `review-agent`   |
| Write PR description  | `pr-agent`       |
| Apply review feedback | `feedback-agent` |

## Feature Development Flow

1. `git status` — check current state
2. Create branch off `develop`: `git checkout -b feat/<scope> origin/develop` (or use `new-branch`)
3. Implement with `feature-agent`
4. Verify with `npm test` and `npm run test:e2e`
5. Verify with `npx tsc -p tsconfig.build.json --noEmit` and `npm run lint`
6. Review diff with `review-agent`
7. Draft PR into `develop` with `pr-agent`

## Bug Fix Flow

1. Reproduce the bug
2. `git checkout -b fix/<scope> origin/develop`
3. Apply minimal fix with `fix-agent` — check the "Known Failure Modes" list in that agent first
4. Add regression test
5. Verify with `npm test`

## Test Writing Flow

- Write jest-based tests with `test-agent`
- Unit test: mock the collaborator (`EurekaService`, `GatewayConfigService`) with a cast object,
  direct instantiation (no DI container needed for a single class)
- e2e test: use `test/support/gateway-test-app.ts`'s `createTestApp()`, which seeds the config
  singleton and overrides `EurekaService`; spin up a real stub HTTP server for anything that needs
  an actual proxy target
- Isolate side effects: always restore `process.env` and close the app in `afterAll`/`afterEach`

## Branching Model

- `develop` is the integration branch. All `feat/`/`fix/`/`chore/`/`refactor/`/`test/`/`docs/`
  branches fork from `origin/develop` and PR back into `develop`.
- `main` is the stable/release branch. It only moves via a separate, manual `develop` → `main`
  release PR — day-to-day feature work never targets `main` directly.

## Git Rules

- No direct commits to `main` or `develop`
- Do not commit or push without explicit request
- Always run `git status` before starting work
- Branch naming: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`
- Do not add a `Co-Authored-By: Claude` (or similar AI attribution) trailer to commits or PRs in this repo — commits are authored by the person running Claude Code, full stop

## Cross-Repo Follow-Ups (not this repo's job, but blocking a real deployment)

- `Expo-Config-Server`: `configs/gateway-local.yml` is added; `gateway-dev.yml` / `gateway-prod.yml`
  still need environment-specific Eureka URLs (`eureka.serviceUrl`) before those profiles can boot
- The JWT public key (the pair of the Auth service's signing key) needs to be in Vault under
  `secret/gateway` as `{"jwt": {"publicKey": "..."}}` — the Config Server deep-merges it in
- The routing table in `gateway-{profile}.yml` is the only place a service prefix lives. Eureka app
  names other than `expo-expo-server`, `expo-form-server`, `expo-application-server`,
  `expo-report-server` are inferred from the `expo-{name}-server` pattern and unconfirmed. A path
  with no matching prefix gets a 404 — there is no catch-all service
