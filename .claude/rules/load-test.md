---
paths:
  - "load-test/**"
  - "tsconfig.build.json"
---

# Load test

- `node load-test/run.mjs run --target local --fast` validates the harness on this machine (stub
  Eureka, `--fast` timings are never reportable). Reportable numbers come from `--target ssh`
  (staging server, real Eureka, CPU-pinned k6/gateway). Read `load-test/README.md` first.
- Staging server rules: only `bench-gw-*` containers and `~/bench/gateway`; teardown is
  `docker compose -p bench-gw down` only; **never** `docker volume prune` / `docker system prune` /
  any server-wide prune; publish ports on `127.0.0.1` only; no host package installs.
- `load-test/` is excluded from `tsconfig.build.json`. If it were compiled by `nest build`, `dist/`
  would gain a `src/` level and `node dist/main` would break.
