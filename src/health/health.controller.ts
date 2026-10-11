import { Controller, Get } from '@nestjs/common';

/** Used by Eureka's `instance.healthCheckUrl` and container/orchestrator liveness probes. */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
