import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { getMetricsRuntime } from '../bootstrap/metrics-runtime-holder';

@Global()
@Module({
  providers: [
    {
      provide: MetricsService,
      useFactory: () => getMetricsRuntime()?.service ?? new MetricsService(),
    },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
