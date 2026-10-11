import { Test } from '@nestjs/testing';
import { createServer, type Server } from 'node:http';
import { setMetricsRuntime } from '../bootstrap/metrics-runtime-holder';
import { MetricsService } from '../metrics/metrics.service';
import { AppModule } from '../app.module';
import {
  setGatewayConfig,
  resetGatewayConfigForTests,
} from '../bootstrap/gateway-config-holder';

describe('EurekaClientModule options provider', () => {
  const originalEnv = { ...process.env };
  let stub: Server;
  let serviceUrl: string;
  let registration: unknown;

  beforeEach(async () => {
    registration = undefined;
    stub = createServer((req, res) => {
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const payload: unknown = JSON.parse(Buffer.concat(chunks).toString());
          registration = payload;
          res.writeHead(204).end();
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ applications: { application: [] } }));
      }
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const address = stub.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing stub address');
    serviceUrl = `http://127.0.0.1:${address.port}/eureka`;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    resetGatewayConfigForTests();
    setMetricsRuntime(undefined);
    await new Promise<void>((resolve, reject) =>
      stub.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it.each([
    ['true', '127.0.0.1', '127.0.0.1', '18206', true],
    ['true', '10.0.0.9', '0.0.0.0', '18106', true],
    ['true', '10.0.0.9', '127.0.0.1', '18206', false],
    ['false', '127.0.0.1', '127.0.0.1', '18206', false],
  ])(
    'generates registration options for enabled=%s IP=%s host=%s port=%s',
    async (enabled, ip, host, port, advertised) => {
      process.env.INSTANCE_HOSTNAME = 'test-gateway';
      process.env.INSTANCE_IP_ADDR = ip;
      process.env.METRICS_ENABLED = enabled;
      process.env.METRICS_HOST = host;
      process.env.METRICS_PORT = port;
      const metrics = new MetricsService();
      setMetricsRuntime(
        enabled === 'true'
          ? { service: metrics, bind: { host, port: Number(port) } }
          : { service: metrics },
      );
      setGatewayConfig({
        jwt: { publicKey: 'pem' },
        routing: { prefixes: {} },
        eureka: { serviceUrl },
      });
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      try {
        expect(moduleRef.get(MetricsService)).toBe(metrics);
        await moduleRef.init();
        expect(registration).toHaveProperty('instance.ipAddr', ip);
        expect(registration).toHaveProperty(
          'instance.metadata',
          advertised
            ? {
                'prometheus.scrape': 'true',
                'prometheus.port': port,
                'prometheus.path': '/metrics',
              }
            : {},
        );
      } finally {
        await moduleRef.close();
      }
    },
  );
});
