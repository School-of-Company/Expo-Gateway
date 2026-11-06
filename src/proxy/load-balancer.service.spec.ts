import type { GatewayConfigService } from '../config/gateway-config.service';
import { MetricsService } from '../metrics/metrics.service';
import { InstanceQuarantine } from './instance-quarantine';
import { LoadBalancerService } from './load-balancer.service';
import type { UpstreamPolicyConfig } from './upstream-policy';
import { EurekaLookupError, NoHealthyInstanceError } from './proxy.errors';
import type {
  EurekaInstance,
  EurekaService,
} from '@school-of-company/nestjs-eureka';

function instance(overrides: Partial<EurekaInstance>): EurekaInstance {
  return {
    instanceId: 'id',
    app: 'EXPO-FORM-SERVER',
    hostName: 'host',
    ipAddr: '10.0.0.1',
    status: 'UP',
    port: 8080,
    metadata: {},
    ...overrides,
  };
}

function config(upstream?: UpstreamPolicyConfig): GatewayConfigService {
  return { getUpstream: () => upstream } as unknown as GatewayConfigService;
}

describe('LoadBalancerService', () => {
  it('round-robins across multiple UP instances', async () => {
    const instances = [
      instance({ ipAddr: '10.0.0.1', port: 1 }),
      instance({ ipAddr: '10.0.0.2', port: 2 }),
    ];
    const eureka = {
      getInstances: jest.fn().mockResolvedValue(instances),
    } as unknown as EurekaService;
    const lb = new LoadBalancerService(eureka, new MetricsService(), config());

    const first = await lb.pickInstanceUrl('expo-form-server');
    const second = await lb.pickInstanceUrl('expo-form-server');
    const third = await lb.pickInstanceUrl('expo-form-server');

    expect(first).toBe('http://10.0.0.1:1');
    expect(second).toBe('http://10.0.0.2:2');
    expect(third).toBe('http://10.0.0.1:1');
  });

  it('filters out DOWN instances', async () => {
    const instances = [
      instance({ ipAddr: '10.0.0.1', port: 1, status: 'DOWN' }),
      instance({ ipAddr: '10.0.0.2', port: 2, status: 'UP' }),
    ];
    const eureka = {
      getInstances: jest.fn().mockResolvedValue(instances),
    } as unknown as EurekaService;
    const lb = new LoadBalancerService(eureka, new MetricsService(), config());

    expect(await lb.pickInstanceUrl('expo-form-server')).toBe(
      'http://10.0.0.2:2',
    );
  });

  it('throws NoHealthyInstanceError when no instance is UP', async () => {
    const instances = [instance({ status: 'DOWN' })];
    const eureka = {
      getInstances: jest.fn().mockResolvedValue(instances),
    } as unknown as EurekaService;
    const lb = new LoadBalancerService(eureka, new MetricsService(), config());

    await expect(lb.pickInstanceUrl('expo-form-server')).rejects.toThrow(
      NoHealthyInstanceError,
    );
  });

  it('throws NoHealthyInstanceError when the app has zero instances', async () => {
    const eureka = {
      getInstances: jest.fn().mockResolvedValue([]),
    } as unknown as EurekaService;
    const lb = new LoadBalancerService(eureka, new MetricsService(), config());

    await expect(lb.pickInstanceUrl('expo-form-server')).rejects.toThrow(
      NoHealthyInstanceError,
    );
  });

  it('wraps a lookup failure in EurekaLookupError', async () => {
    const eureka = {
      getInstances: jest.fn().mockRejectedValue(new Error('network error')),
    } as unknown as EurekaService;
    const lb = new LoadBalancerService(eureka, new MetricsService(), config());

    await expect(lb.pickInstanceUrl('expo-form-server')).rejects.toThrow(
      EurekaLookupError,
    );
  });

  describe('metrics', () => {
    async function metricLine(
      metrics: MetricsService,
      prefix: string,
    ): Promise<string | undefined> {
      return (await metrics.render())
        .split('\n')
        .find((line) => line.startsWith(prefix));
    }

    it('records the lookup duration on success and leaves the failure counter at zero', async () => {
      const metrics = new MetricsService();
      const eureka = {
        getInstances: jest.fn().mockResolvedValue([instance({})]),
      } as unknown as EurekaService;
      const lb = new LoadBalancerService(eureka, metrics, config());

      await lb.pickInstanceUrl('expo-form-server');

      expect(
        await metricLine(
          metrics,
          'gateway_eureka_lookup_duration_seconds_count{app="expo-form-server"}',
        ),
      ).toMatch(/ 1$/);
      expect(
        await metricLine(
          metrics,
          'gateway_eureka_lookup_failures_total{app="expo-form-server"}',
        ),
      ).toBeUndefined();
    });

    it('counts a failed lookup', async () => {
      const metrics = new MetricsService();
      const eureka = {
        getInstances: jest.fn().mockRejectedValue(new Error('boom')),
      } as unknown as EurekaService;
      const lb = new LoadBalancerService(eureka, metrics, config());

      await expect(lb.pickInstanceUrl('expo-form-server')).rejects.toThrow(
        EurekaLookupError,
      );

      expect(
        await metricLine(
          metrics,
          'gateway_eureka_lookup_failures_total{app="expo-form-server"}',
        ),
      ).toMatch(/ 1$/);
    });

    it('never writes the healthy-instances gauge (only the poller does)', async () => {
      const metrics = new MetricsService();
      const eureka = {
        getInstances: jest.fn().mockResolvedValue([instance({})]),
      } as unknown as EurekaService;
      await new LoadBalancerService(eureka, metrics, config()).pickInstanceUrl(
        'a',
      );

      expect(
        await metricLine(metrics, 'gateway_upstream_healthy_instances{'),
      ).toBeUndefined();
    });
  });

  describe('upstream policy', () => {
    const lookup = (
      instances: EurekaInstance[],
      upstream?: UpstreamPolicyConfig,
    ) => {
      const eureka = {
        getInstances: jest.fn().mockResolvedValue(instances),
      } as unknown as EurekaService;
      const metrics = new MetricsService();
      return {
        metrics,
        lb: new LoadBalancerService(eureka, metrics, config(upstream)),
      };
    };

    it('never proxies to the cloud metadata address, even by default', async () => {
      const { lb } = lookup([
        instance({ ipAddr: '169.254.169.254', port: 80 }),
        instance({ ipAddr: '10.0.0.2', port: 2 }),
      ]);
      expect(await lb.pickInstanceUrl('a')).toBe('http://10.0.0.2:2');
      expect(await lb.pickInstanceUrl('a')).toBe('http://10.0.0.2:2');
    });

    it('answers 503 (NoHealthyInstanceError) when every instance is rejected', async () => {
      const { lb, metrics } = lookup([
        instance({ ipAddr: '::ffff:169.254.169.254', port: 80 }),
      ]);
      await expect(lb.pickInstanceUrl('a')).rejects.toBeInstanceOf(
        NoHealthyInstanceError,
      );
      expect(await metrics.render()).toContain(
        'gateway_upstream_rejected_instances_total{app="a"} 1',
      );
    });

    it('rejects hostnames and malformed ports', async () => {
      const { lb } = lookup([
        instance({ ipAddr: 'metadata.internal', port: 80 }),
        instance({ ipAddr: '10.0.0.1', port: 70000 }),
        instance({ ipAddr: '10.0.0.1', port: 1.5 }),
      ]);
      await expect(lb.pickInstanceUrl('a')).rejects.toBeInstanceOf(
        NoHealthyInstanceError,
      );
    });

    it('keeps loopback usable by default (local development)', async () => {
      const { lb } = lookup([instance({ ipAddr: '127.0.0.1', port: 3000 })]);
      expect(await lb.pickInstanceUrl('a')).toBe('http://127.0.0.1:3000');
    });

    it('limits traffic to allowedCidrs and allowedPorts when configured', async () => {
      const { lb } = lookup(
        [
          instance({ ipAddr: '127.0.0.1', port: 8080 }),
          instance({ ipAddr: '10.1.2.3', port: 9999 }),
          instance({ ipAddr: '10.1.2.4', port: 8080 }),
        ],
        {
          allowedCidrs: ['10.1.0.0/16'],
          allowedPorts: { min: 8000, max: 8999 },
        },
      );
      expect(await lb.pickInstanceUrl('a')).toBe('http://10.1.2.4:8080');
    });

    it('cannot be widened to reach a blocked range through allowedCidrs', async () => {
      const { lb } = lookup(
        [instance({ ipAddr: '169.254.169.254', port: 80 })],
        { allowedCidrs: ['0.0.0.0/0'] },
      );
      await expect(lb.pickInstanceUrl('a')).rejects.toBeInstanceOf(
        NoHealthyInstanceError,
      );
    });
  });
});

describe('LoadBalancerService passive health check', () => {
  const instances = [
    instance({ ipAddr: '10.0.0.1', port: 1 }),
    instance({ ipAddr: '10.0.0.2', port: 2 }),
  ];
  let now: number;
  let metrics: MetricsService;
  let lb: LoadBalancerService;

  beforeEach(() => {
    now = 0;
    metrics = new MetricsService();
    const eureka = {
      getInstances: jest.fn().mockResolvedValue(instances),
    } as unknown as EurekaService;
    lb = new LoadBalancerService(
      eureka,
      metrics,
      config(),
      new InstanceQuarantine(10_000, () => now),
    );
  });

  it('skips an instance that refused a connection until the quarantine runs out', async () => {
    lb.reportConnectFailure('app', 'http://10.0.0.1:1', 'refused');

    const picks: string[] = [];
    for (let i = 0; i < 4; i++) picks.push(await lb.pickInstanceUrl('app'));
    expect(new Set(picks)).toEqual(new Set(['http://10.0.0.2:2']));

    now = 10_000;
    const after = [
      await lb.pickInstanceUrl('app'),
      await lb.pickInstanceUrl('app'),
    ];
    expect(new Set(after)).toEqual(
      new Set(['http://10.0.0.1:1', 'http://10.0.0.2:2']),
    );
  });

  it('tries every instance when all of them are quarantined (fail-open)', async () => {
    lb.reportConnectFailure('app', 'http://10.0.0.1:1', 'refused');
    lb.reportConnectFailure('app', 'http://10.0.0.2:2', 'timeout');

    const picks = [
      await lb.pickInstanceUrl('app'),
      await lb.pickInstanceUrl('app'),
    ];
    expect(new Set(picks)).toEqual(
      new Set(['http://10.0.0.1:1', 'http://10.0.0.2:2']),
    );
  });

  it('picks a different instance for a retry, or none when there is no other', async () => {
    expect(await lb.pickRetryUrl('app', 'http://10.0.0.1:1')).toBe(
      'http://10.0.0.2:2',
    );

    const single = new LoadBalancerService(
      {
        getInstances: jest.fn().mockResolvedValue([instances[0]]),
      } as unknown as EurekaService,
      metrics,
      config(),
    );
    expect(
      await single.pickRetryUrl('app', 'http://10.0.0.1:1'),
    ).toBeUndefined();
  });

  it('records failures, quarantine events and the quarantined count', async () => {
    lb.reportConnectFailure('app', 'http://10.0.0.1:1', 'refused');
    lb.reportConnectFailure('app', 'http://10.0.0.1:1', 'refused');
    await lb.pickInstanceUrl('app');

    const text = await metrics.render();
    expect(text).toContain(
      'gateway_upstream_connect_failures_total{app="app",reason="refused"} 2',
    );
    expect(text).toContain('gateway_upstream_quarantines_total{app="app"} 1');
    expect(text).toContain(
      'gateway_upstream_quarantined_instances{app="app"} 1',
    );
  });
});
