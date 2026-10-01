import { All, Controller, Module, Req, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EurekaModule } from '@school-of-company/nestjs-eureka';
import { networkInterfaces } from 'node:os';
import type { Request, Response } from 'express';

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

// Register the container's own IP, like a real service does. A hostname would
// make the gateway resolve DNS on every proxied request, and once the
// container is gone a failing lookup is slow enough to starve libuv's
// 4-thread pool and stall every other outbound call, Eureka included.
function ownIp(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No non-internal IPv4 address found');
}

const appName = env('APP_NAME');
const port = Number(env('PORT', '4000'));
const hostName = env('HOST_NAME');
const latencyMs = Number(env('LATENCY_MS', '20'));
const jitterMs = Number(env('JITTER_MS', '10'));

@Controller()
class EchoController {
  @All('/{*splat}')
  async echo(@Req() req: Request, @Res() res: Response): Promise<void> {
    await new Promise((resolve) =>
      setTimeout(resolve, latencyMs + Math.random() * jitterMs),
    );
    res.json({ service: appName, path: req.path });
  }
}

// Registration, heartbeat and deregistration all come from the real
// nestjs-eureka library, so a SIGTERM run exercises its deregister-on-shutdown
// against the Eureka server, and a SIGKILL run leaves a genuine stale lease.
@Module({
  imports: [
    EurekaModule.forRoot({
      serviceUrl: env('EUREKA_URL'),
      heartbeatIntervalSeconds: Number(env('HEARTBEAT_SECONDS', '30')),
      leaseDurationSeconds: Number(env('LEASE_SECONDS', '90')),
      instance: {
        app: appName,
        hostName,
        ipAddr: process.env.IP_ADDR ?? ownIp(),
        port,
        instanceId: `${hostName}:${appName}:${port}`,
      },
    }),
  ],
  controllers: [EchoController],
})
class StubBackendModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(StubBackendModule);
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
