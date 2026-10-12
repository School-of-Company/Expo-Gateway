import { createHash, timingSafeEqual } from 'node:crypto';
import type { DocsBasicAuthConfig } from '../bootstrap/gateway-config.types';

/** 브라우저 기본 인증창에 보이는 이름. */
export const DOCS_REALM = 'docs';

const sha256 = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

/**
 * `Authorization: Basic <base64(user:password)>` 헤더가 문서 자격 증명과 같은지 본다.
 * 길이가 달라도 같은 길이의 해시로 상수 시간 비교하고, 사용자 이름과 비밀번호를
 * 둘 다 비교한 뒤에 합친다(어느 쪽이 틀렸는지 시간으로 드러나지 않게 한다).
 */
export function matchesDocsBasicAuth(
  header: string | undefined,
  expected: DocsBasicAuthConfig,
): boolean {
  if (!header || !/^Basic /i.test(header)) {
    return false;
  }
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString(
    'utf8',
  );
  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return false;
  }
  const userOk = timingSafeEqual(
    sha256(decoded.slice(0, separator)),
    sha256(expected.username),
  );
  const passwordOk = timingSafeEqual(
    sha256(decoded.slice(separator + 1)),
    sha256(expected.password),
  );
  return userOk && passwordOk;
}
