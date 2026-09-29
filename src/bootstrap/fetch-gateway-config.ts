import { parseGatewayConfig } from './gateway-config.validate';
import type { GatewayConfig } from './gateway-config.types';

export class ConfigServerError extends Error {}

/**
 * Calls the org-wide Config Server contract: `GET /configs/gateway/:profile`.
 * Any failure (network error, non-2xx) throws — the caller (`run.ts`) treats
 * every failure identically as fail-fast, matching every other service in
 * this MSA (no retries, no special-casing local).
 */
export async function fetchGatewayConfig(
  configServerUrl: string,
  profile: string,
): Promise<GatewayConfig> {
  const url = `${configServerUrl.replace(/\/+$/, '')}/configs/gateway/${encodeURIComponent(profile)}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new ConfigServerError(
      `Could not reach Config Server at ${url}: ${(err as Error).message}`,
    );
  }

  if (!response.ok) {
    throw new ConfigServerError(
      `Config Server responded ${response.status} for ${url}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new ConfigServerError(
      `Config Server response for ${url} was not valid JSON: ${(err as Error).message}`,
    );
  }

  return parseGatewayConfig(body);
}
