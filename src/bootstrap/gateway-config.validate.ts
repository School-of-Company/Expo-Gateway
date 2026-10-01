import { isValidPublicPathEntry } from '../auth/public-path.matcher';
import type { GatewayConfig } from './gateway-config.types';

export class InvalidGatewayConfigError extends Error {
  constructor(reason: string) {
    super(`Invalid gateway config: ${reason}`);
    this.name = 'InvalidGatewayConfigError';
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((v) => typeof v === 'string');
}

/**
 * Structural validation only — this is boot-time config from a trusted
 * internal Config Server, not user input, so we check shape, not content.
 */
export function parseGatewayConfig(raw: unknown): GatewayConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidGatewayConfigError('response body is not an object');
  }
  const candidate = raw as Record<string, unknown>;

  const jwt = candidate.jwt as Record<string, unknown> | undefined;
  if (!jwt || !isNonEmptyString(jwt.publicKey)) {
    throw new InvalidGatewayConfigError(
      'jwt.publicKey is required and must be a non-empty string',
    );
  }

  const eureka = candidate.eureka as Record<string, unknown> | undefined;
  if (!eureka) {
    throw new InvalidGatewayConfigError('eureka is required');
  }
  const serviceUrl = eureka.serviceUrl;
  const validServiceUrl =
    isNonEmptyString(serviceUrl) ||
    (Array.isArray(serviceUrl) &&
      serviceUrl.length > 0 &&
      serviceUrl.every(isNonEmptyString));
  if (!validServiceUrl) {
    throw new InvalidGatewayConfigError(
      'eureka.serviceUrl is required and must be a non-empty string or array of strings',
    );
  }

  const routing = candidate.routing as Record<string, unknown> | undefined;
  if (
    !routing ||
    !isRecordOfStrings(routing.prefixes) ||
    Object.keys(routing.prefixes).length === 0
  ) {
    throw new InvalidGatewayConfigError(
      'routing.prefixes is required and must be a non-empty map of path prefix to Eureka app name',
    );
  }

  if (candidate.rateLimit !== undefined) {
    const rateLimit = candidate.rateLimit as Record<string, unknown>;
    if (
      typeof rateLimit.ttlSeconds !== 'number' ||
      typeof rateLimit.limit !== 'number'
    ) {
      throw new InvalidGatewayConfigError(
        'rateLimit.ttlSeconds and rateLimit.limit must be numbers when rateLimit is present',
      );
    }
  }

  if (candidate.publicPaths !== undefined) {
    if (
      !Array.isArray(candidate.publicPaths) ||
      !candidate.publicPaths.every(
        (entry) => isNonEmptyString(entry) && isValidPublicPathEntry(entry),
      )
    ) {
      throw new InvalidGatewayConfigError(
        'publicPaths must be an array of "/prefix" or "METHOD /path" strings',
      );
    }
  }

  if (candidate.port !== undefined && typeof candidate.port !== 'number') {
    throw new InvalidGatewayConfigError('port must be a number when present');
  }

  return candidate as unknown as GatewayConfig;
}
