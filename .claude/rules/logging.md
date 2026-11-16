---
paths:
  - "src/logging/**"
  - "src/proxy/http-access-log.middleware.ts"
  - "src/main.ts"
---

# Logging

The Expo log standard, shared by every service (Spring and Nest) so the shared Loki in Expo-Monitoring labels them the same way:

- Every line on stdout is one JSON object with at least `@timestamp` (ISO-8601), `level` (uppercase
  `TRACE`/`DEBUG`/`INFO`/`WARN`/`ERROR`; Nest `fatal` is written as `ERROR`, `verbose` as `TRACE`),
  `service` (`expo-gateway`, the Eureka app name), `module` and `message`. Errors add `stack_trace`.
  Nothing else goes to stdout — never `console.log`.
- The log pipeline reads only these key names and has no per-service fallback. If the gateway's logs
  are missing or mis-labelled, fix the log output here, never add parsing fallbacks to the pipeline.
- `src/logging/json-logger.ts` (`JsonLogger`, pino) is installed with `Logger.overrideLogger()` in
  `main.ts` **before** `runBootstrap()`, so pre-Nest bootstrap lines and fail-fast exits are JSON too.
  `module` is the Nest logger context (`new Logger(Foo.name)`), the same mapping as nestjs-pino's
  `renameContext: 'module'`; lines without a context get `app`. Never pass `module` at the call site.
- `LOG_LEVEL` (default `info`). With `PROFILE=local` stdout is also mirrored to
  `${EXPO_LOG_DIR:-~/.expo/logs}/expo-gateway/app.log` for the local Loki file tail. Other profiles
  write stdout only (pm2 captures it); add no log file settings there.
- Access log: `HttpAccessLogMiddleware` (`src/proxy/http-access-log.middleware.ts`, module
  `HttpAccess`) writes one line per request, `<METHOD> <path> status: <code> (<ms>ms)[ -> <app>]`
  (e.g. `GET /forms/123 status: 200 (12ms) -> expo-form-server`), on
  `finish`, or as 499 when the client leaves first (never twice). Level: INFO <400, WARN 4xx, ERROR
  5xx/499. It is registered in `AppModule` ahead of `CorsMiddleware`, so preflights, guard
  rejections and gateway 404/502/503/504 are logged too. `/health`, `/docs/**` and the
  `docs.services[].url` fetches are skipped. `HTTP_ACCESS_LOG_ENABLED=false` turns it off
  (default on). The path never includes the query string; add no header/cookie/body/IP fields.
- Never log a JWT, key, header value, query string, or the Config Server body.
