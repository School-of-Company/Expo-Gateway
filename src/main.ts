import { Logger } from '@nestjs/common';
import { readLogEnv } from './bootstrap/env';
import { runBootstrap } from './bootstrap/run';
import { GATEWAY_EUREKA_APP_NAME } from './eureka/eureka-options.factory';
import { createPino, defaultLogDir, JsonLogger } from './logging/json-logger';

Logger.overrideLogger(
  new JsonLogger(
    createPino({
      service: GATEWAY_EUREKA_APP_NAME,
      ...readLogEnv(defaultLogDir()),
    }),
  ),
);

runBootstrap().catch((err: unknown) => {
  new Logger('Bootstrap').fatal(err instanceof Error ? err : String(err));
  process.exit(1);
});
