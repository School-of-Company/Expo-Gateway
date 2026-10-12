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
  password?: string,
): Promise<GatewayConfig> {
  const url = `${configServerUrl.replace(/\/+$/, '')}/configs/gateway/${encodeURIComponent(profile)}`;
  // Config Server 인증(Expo-Config-Server#54). 비밀번호가 없으면 헤더 없이 호출한다 —
  // 인증을 켜기 전의 Config Server 와도 그대로 동작하게 하려는 것이다.
  const headers: Record<string, string> = password
    ? {
        Authorization: `Basic ${Buffer.from(`gateway:${password}`).toString('base64')}`,
      }
    : {};

  let response: Response;
  try {
    response = await fetch(url, { headers });
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
