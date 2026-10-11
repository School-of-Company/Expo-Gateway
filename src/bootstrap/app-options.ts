import type { NestApplicationOptions } from '@nestjs/common';

/**
 * Nest's default JSON/urlencoded body parsers consume the request stream
 * before the proxy controller runs, so http-proxy-middleware would forward an
 * empty body (and the upstream call hangs on the original Content-Length).
 * The gateway never needs to read a body — the upstream service does.
 */
export const GATEWAY_APP_OPTIONS: NestApplicationOptions = {
  bodyParser: false,
};
