import { isValidPublicPathEntry } from '../auth/public-path.matcher';
import { isExactOrigin } from '../cors/cors.policy';
import type { GatewayConfig } from './gateway-config.types';
import { isTrustedProxyEntry } from './trust-proxy';

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

function isPositiveIntegerPolicy(
  value: unknown,
): value is { ttlSeconds: number; limit: number } {
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

const DOCS_AUTH_MIN_PASSWORD_LENGTH = 12;
const DOCS_AUTH_MAX_LENGTH = 128;

/** 비밀 값은 오류 메시지에 싣지 않는다. 어느 항목이 틀렸는지만 알린다. */
function validateDocsAuth(docs: Record<string, unknown>): void {
  if (docs.tryItOut !== undefined && typeof docs.tryItOut !== 'boolean') {
    throw new InvalidGatewayConfigError('docs.tryItOut must be a boolean');
  }
  if (docs.requireAuth !== undefined && typeof docs.requireAuth !== 'boolean') {
    throw new InvalidGatewayConfigError('docs.requireAuth must be a boolean');
  }
  const { basicAuth } = docs;
  if (basicAuth === undefined) {
    if (docs.requireAuth === true) {
      throw new InvalidGatewayConfigError(
        'docs.basicAuth is required when docs.requireAuth is true',
      );
    }
    return;
  }
  const auth =
    typeof basicAuth === 'object' && basicAuth !== null
      ? (basicAuth as Record<string, unknown>)
      : {};
  if (
    !isNonEmptyString(auth.username) ||
    auth.username.length > DOCS_AUTH_MAX_LENGTH ||
    auth.username.includes(':')
  ) {
    throw new InvalidGatewayConfigError(
      `docs.basicAuth.username must be a non-empty string of at most ${DOCS_AUTH_MAX_LENGTH} characters without ":"`,
    );
  }
  if (
    !isNonEmptyString(auth.password) ||
    auth.password.length < DOCS_AUTH_MIN_PASSWORD_LENGTH ||
    auth.password.length > DOCS_AUTH_MAX_LENGTH
  ) {
    throw new InvalidGatewayConfigError(
      `docs.basicAuth.password must be a string of ${DOCS_AUTH_MIN_PASSWORD_LENGTH} to ${DOCS_AUTH_MAX_LENGTH} characters`,
    );
  }
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
  validateDocsAuth(docs);
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
    if (!isPositiveIntegerPolicy(rateLimit)) {
      throw new InvalidGatewayConfigError(
        'rateLimit.ttlSeconds and rateLimit.limit must be positive safe integers when rateLimit is present',
      );
    }
    const policies: Record<string, unknown> = {
      sms: 'sms' in rateLimit ? rateLimit.sms : undefined,
      survey: 'survey' in rateLimit ? rateLimit.survey : undefined,
      participantAuthCode:
        'participantAuthCode' in rateLimit
          ? rateLimit.participantAuthCode
          : undefined,
      signin: 'signin' in rateLimit ? rateLimit.signin : undefined,
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

  if (
    candidate.trustedProxies !== undefined &&
    (!Array.isArray(candidate.trustedProxies) ||
      !candidate.trustedProxies.every(isTrustedProxyEntry))
  ) {
    throw new InvalidGatewayConfigError(
      'trustedProxies must be an array of "IP" or "IP/prefix" strings (IPv4 /24 or narrower, IPv6 /64 or narrower, no IPv4-mapped IPv6)',
    );
  }

  if (candidate.port !== undefined && typeof candidate.port !== 'number') {
    throw new InvalidGatewayConfigError('port must be a number when present');
  }

  return candidate as unknown as GatewayConfig;
}
