/** 통합 API 문서 화면이 차지하는 경로. 어느 서비스 접두사도 아니다. */
export const DOCS_PATH = '/docs';

export function isDocsPath(path: string): boolean {
  return path === DOCS_PATH || path.startsWith(`${DOCS_PATH}/`);
}

/**
 * `docs.enabled`일 때만 `/docs`와 그 하위(화면, 설정, Swagger UI 정적 파일)의
 * 조회 요청을 JWT 없이 연다. `publicPaths`의 메서드 지정 항목은 정확히 한 경로만
 * 열 수 있어 여러 파일로 이뤄진 화면을 표현하지 못하므로 명시 규칙으로 둔다.
 * 각 서비스의 OpenAPI 경로는 여기서 열지 않고 Config Server `publicPaths`가 연다.
 */
export function isPublicDocsRequest(
  docsEnabled: boolean,
  path: string,
  method: string,
): boolean {
  const requestMethod = method.toUpperCase();
  return (
    docsEnabled &&
    isDocsPath(path) &&
    (requestMethod === 'GET' || requestMethod === 'HEAD')
  );
}
