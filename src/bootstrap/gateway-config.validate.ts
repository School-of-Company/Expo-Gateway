import { isValidPublicPathEntry } from '../auth/public-path.matcher';
import { isExactOrigin } from '../cors/cors.policy';
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

function isPositiveIntegerPolicy(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const { ttlSeconds, limit } = value as Record<string, unknown>;
  return (
    typeof ttlSeconds === 'number' &&
    typeof limit === 'number' &&
    Number.isSafeInteger(ttlSeconds) &&
    ttlSeconds > 0 &&
    Number.isSafeInteger(limit) &&
    limit > 0
  );
}

export const DOCS_MAX_SERVICES = 30;
const DOCS_MAX_TEXT_LENGTH = 100;

/**
 * 게이트웨이 기준 경로만 허용한다: `/` 로 시작하고, `//`(프로토콜 상대 URL),
 * `://`(스킴), 역슬래시, 공백/제어문자를 포함하지 않는다. 외부 호스트를
 * 가리킬 수 없게 하려는 것이다.
 */
function isGatewayRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.includes('//') &&
    !value.includes('://') &&
    !/[\\\s]/.test(value) &&
    ![...value].some(
      (ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f,
    )
  );
}

function validateDocs(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InvalidGatewayConfigError('docs must be an object when present');
  }
  const docs = raw as Record<string, unknown>;
  if (typeof docs.enabled !== 'boolean') {
    throw new InvalidGatewayConfigError('docs.enabled must be a boolean');
  }
  if (!docs.enabled) {
    return;
  }
  if (
    docs.title !== undefined &&
    (!isNonEmptyString(docs.title) || docs.title.length > DOCS_MAX_TEXT_LENGTH)
  ) {
    throw new InvalidGatewayConfigError(
      `docs.title must be a non-empty string of at most ${DOCS_MAX_TEXT_LENGTH} characters when present`,
    );
  }
  const { services } = docs;
  if (
    !Array.isArray(services) ||
    services.length === 0 ||
    services.length > DOCS_MAX_SERVICES
  ) {
    throw new InvalidGatewayConfigError(
      `docs.services must be a non-empty array of at most ${DOCS_MAX_SERVICES} entries when docs is enabled`,
    );
  }
  for (const service of services as unknown[]) {
    const entry =
      typeof service === 'object' && service !== null
        ? (service as Record<string, unknown>)
        : {};
    if (
      !isNonEmptyString(entry.name) ||
      entry.name.length > DOCS_MAX_TEXT_LENGTH
    ) {
      throw new InvalidGatewayConfigError(
        `docs.services[].name must be a non-empty string of at most ${DOCS_MAX_TEXT_LENGTH} characters`,
      );
    }
    if (!isGatewayRelativePath(entry.url)) {
      throw new InvalidGatewayConfigError(
        'docs.services[].url must be a gateway path starting with "/" (no "//", scheme, host, backslash or whitespace)',
      );
    }
  }
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
    const rateLimit = candidate.rateLimit;
    if (
      typeof rateLimit !== 'object' ||
      rateLimit === null ||
      !('ttlSeconds' in rateLimit) ||
      !('limit' in rateLimit) ||
      typeof rateLimit.ttlSeconds !== 'number' ||
      typeof rateLimit.limit !== 'number'
    ) {
      throw new InvalidGatewayConfigError(
        'rateLimit.ttlSeconds and rateLimit.limit must be numbers when rateLimit is present',
      );
    }
    const policies: Record<string, unknown> = {
      sms: 'sms' in rateLimit ? rateLimit.sms : undefined,
      survey: 'survey' in rateLimit ? rateLimit.survey : undefined,
      participantAuthCode:
        'participantAuthCode' in rateLimit
          ? rateLimit.participantAuthCode
          : undefined,
    };
    for (const [name, policy] of Object.entries(policies)) {
      if (policy !== undefined && !isPositiveIntegerPolicy(policy)) {
        throw new InvalidGatewayConfigError(
          `rateLimit.${name}.ttlSeconds and rateLimit.${name}.limit must be positive safe integers`,
        );
      }
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

  if (candidate.docs !== undefined) {
    validateDocs(candidate.docs);
  }

  if (candidate.cors !== undefined) {
    const cors = candidate.cors as Record<string, unknown> | null;
    const origins = cors?.allowedOrigins;
    if (
      !Array.isArray(origins) ||
      origins.length === 0 ||
      !origins.every(isExactOrigin)
    ) {
      throw new InvalidGatewayConfigError(
        'cors.allowedOrigins must be a non-empty array of exact http(s) origins (no "*", path or trailing slash)',
      );
    }
  }

  if (candidate.port !== undefined && typeof candidate.port !== 'number') {
    throw new InvalidGatewayConfigError('port must be a number when present');
  }

  return candidate as unknown as GatewayConfig;
}
