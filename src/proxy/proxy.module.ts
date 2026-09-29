import { Module } from '@nestjs/common';
import { EurekaClientModule } from '../eureka/eureka-client.module';
import { ProxyController } from './proxy.controller';
import { RouteResolverService } from './route-resolver.service';
import { LoadBalancerService } from './load-balancer.service';

@Module({
  imports: [EurekaClientModule],
  controllers: [ProxyController],
  providers: [RouteResolverService, LoadBalancerService],
})
export class ProxyModule {}
