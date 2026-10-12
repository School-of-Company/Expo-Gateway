import { Controller, Get, Next, Param, Res } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { dirname } from 'node:path';
import { GatewayConfigService } from '../config/gateway-config.service';

const SWAGGER_UI_DIR = dirname(require.resolve('swagger-ui-dist/package.json'));

/** 게이트웨이가 직접 내려주는 Swagger UI 파일. 이 목록에 없는 이름은 404다. */
const ASSET_FILES = new Set([
  'swagger-ui.css',
  'swagger-ui-bundle.js',
  'swagger-ui-standalone-preset.js',
  'favicon-16x16.png',
  'favicon-32x32.png',
]);

const DEFAULT_TITLE = 'API 문서';

// 설정값은 HTML/스크립트에 끼워 넣지 않는다. 화면과 초기화 스크립트는 고정이고
// 서비스 목록은 /docs/config.json(JSON)으로만 전달되므로 문자열 주입이 없다.
const INDEX_HTML = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${DEFAULT_TITLE}</title>
    <link rel="icon" type="image/png" href="/docs/assets/favicon-32x32.png" />
    <link rel="stylesheet" href="/docs/assets/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/assets/swagger-ui-bundle.js"></script>
    <script src="/docs/assets/swagger-ui-standalone-preset.js"></script>
    <script src="/docs/swagger-initializer.js"></script>
  </body>
</html>
`;

const INITIALIZER_JS = `window.addEventListener('load', function () {
  var root = document.getElementById('swagger-ui');
  fetch('/docs/config.json', { headers: { Accept: 'application/json' } })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (config) {
      document.title = config.title;
      window.ui = SwaggerUIBundle({
        urls: config.services,
        'urls.primaryName': config.services[0].name,
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'StandaloneLayout',
        // A service's springdoc "servers" can be its own instance address
        // (Host is rewritten when proxying). Every call goes to the gateway, so
        // Try it out never bypasses JWT/routing nor sends a token elsewhere.
        requestInterceptor: function (req) {
          try {
            var url = new URL(req.url, window.location.href);
            req.url = window.location.origin + url.pathname + url.search;
          } catch (e) {
            // An unparsable URL cannot be fetched anyway; let Swagger UI report it.
          }
          return req;
        },
      });
    })
    .catch(function (err) {
      root.textContent = 'API 문서 설정을 불러오지 못했습니다: ' + err.message;
    });
});
`;

/**
 * 서비스별 Swagger를 한 화면에서 보는 `GET /docs`. `docs.enabled`가 아니면 모든
 * 핸들러가 `next()`로 넘겨, 이 기능이 없을 때와 똑같이 동작한다(등록된 접두사가
 * 아니므로 404).
 */
@Controller('docs')
export class DocsController {
  constructor(private readonly gatewayConfig: GatewayConfigService) {}

  @Get()
  index(@Res() res: Response, @Next() next: NextFunction): void {
    if (!this.gatewayConfig.getDocs()) {
      next();
      return;
    }
    res.type('html').send(INDEX_HTML);
  }

  @Get('config.json')
  config(@Res() res: Response, @Next() next: NextFunction): void {
    const docs = this.gatewayConfig.getDocs();
    if (!docs) {
      next();
      return;
    }
    res.set('Cache-Control', 'no-store').json({
      title: docs.title ?? DEFAULT_TITLE,
      services: (docs.services ?? []).map(({ name, url }) => ({ name, url })),
    });
  }

  @Get('swagger-initializer.js')
  initializer(@Res() res: Response, @Next() next: NextFunction): void {
    if (!this.gatewayConfig.getDocs()) {
      next();
      return;
    }
    res.type('js').send(INITIALIZER_JS);
  }

  @Get('assets/:file')
  asset(
    @Param('file') file: string,
    @Res() res: Response,
    @Next() next: NextFunction,
  ): void {
    if (!this.gatewayConfig.getDocs() || !ASSET_FILES.has(file)) {
      next();
      return;
    }
    res.sendFile(file, { root: SWAGGER_UI_DIR, maxAge: '1h' }, (err) => {
      if (err && !res.headersSent) {
        next(err);
      }
    });
  }
}
