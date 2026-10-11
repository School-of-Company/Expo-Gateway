import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { EurekaClientModule } from '../eureka/eureka-client.module';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { LoadBalancerService } from './load-balancer.service';
import { ProxyController } from './proxy.controller';
import { RouteResolverService } from './route-resolver.service';
import { UpstreamHealthPoller } from './upstream-health.poller';

@Module({
  imports: [EurekaClientModule],
  controllers: [ProxyController],
  providers: [
    RouteResolverService,
    LoadBalancerService,
    UpstreamHealthPoller,
    HttpMetricsMiddleware,
  ],
})
export class ProxyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('{*splat}');
  }
}
