import type {
  EurekaInstance,
  EurekaService,
} from '@school-of-company/nestjs-eureka';
import type { GatewayConfigService } from '../config/gateway-config.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  UPSTREAM_POLL_INTERVAL_MS,
  UpstreamHealthPoller,
} from './upstream-health.poller';

function instance(
  status: EurekaInstance['status'],
  port = 8080,
): EurekaInstance {
  return {
    instanceId: `i-${status}-${port}`,
    app: 'A',
    hostName: 'h',
    ipAddr: '10.0.0.1',
    status,
    port,
    metadata: {},
  };
}

function setup(getInstances: jest.Mock) {
  const metrics = new MetricsService();
  const config = {
    getRouting: () => ({
      prefixes: {
        '/forms': 'expo-form-server',
        '/surveys': 'expo-form-server',
        '/sms': 'expo-sms-server',
      },
    }),
  } as unknown as GatewayConfigService;
  const poller = new UpstreamHealthPoller(
    { getInstances } as unknown as EurekaService,
    config,
    metrics,
  );
  const render = async () => (await metrics.render()).split('\n');
  return { poller, metrics, render, getInstances };
}

describe('UpstreamHealthPoller', () => {
  it('records the UP instance count once per distinct app', async () => {
    const getInstances = jest
      .fn()
      .mockImplementation((app: string) =>
        Promise.resolve(
          app === 'expo-form-server'
            ? [instance('UP', 1), instance('UP', 2), instance('DOWN', 3)]
            : [instance('UP', 1)],
        ),
      );
    const { poller, render } = setup(getInstances);

    await poller.pollOnce();

    expect(getInstances).toHaveBeenCalledTimes(2);
    const lines = await render();
    expect(lines).toContain(
      'gateway_upstream_healthy_instances{app="expo-form-server"} 2',
    );
    expect(lines).toContain(
      'gateway_upstream_healthy_instances{app="expo-sms-server"} 1',
    );
  });

  it('reports 0 (not a missing series) when no instance is UP', async () => {
    const { poller, render } = setup(
      jest.fn().mockResolvedValue([instance('DOWN')]),
    );

    await poller.pollOnce();

    expect(await render()).toContain(
      'gateway_upstream_healthy_instances{app="expo-sms-server"} 0',
    );
  });

  it('drops the series, counts the failure and keeps going when a lookup fails', async () => {
    const getInstances = jest
      .fn()
      .mockResolvedValueOnce([instance('UP')])
      .mockResolvedValueOnce([instance('UP')])
      .mockRejectedValue(new Error('eureka down'));
    const { poller, render } = setup(getInstances);

    await poller.pollOnce();
    await expect(poller.pollOnce()).resolves.toBeUndefined();

    const lines = await render();
    expect(
      lines.some((l) => l.startsWith('gateway_upstream_healthy_instances{')),
    ).toBe(false);
    expect(lines).toContain(
      'gateway_upstream_poll_failures_total{app="expo-sms-server"} 1',
    );
  });

  it('does not touch the per-request Eureka lookup metrics', async () => {
    const { poller, render } = setup(
      jest.fn().mockResolvedValue([instance('UP')]),
    );

    await poller.pollOnce();

    const lines = await render();
    expect(
      lines.some((l) =>
        l.startsWith('gateway_eureka_lookup_duration_seconds_count{'),
      ),
    ).toBe(false);
    expect(
      lines.some((l) => l.startsWith('gateway_eureka_lookup_failures_total{')),
    ).toBe(false);
  });

  it('skips a tick while the previous poll is still running', async () => {
    const releases: Array<() => void> = [];
    const getInstances = jest.fn().mockImplementation(
      () =>
        new Promise<EurekaInstance[]>((resolve) => {
          releases.push(() => resolve([]));
        }),
    );
    const { poller } = setup(getInstances);

    const first = poller.pollOnce();
    await poller.pollOnce();
    expect(getInstances).toHaveBeenCalledTimes(2);

    releases.forEach((release) => release());
    await first;
  });

  describe('scheduling', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('polls on bootstrap and every interval until shutdown', async () => {
      const { poller, getInstances } = setup(jest.fn().mockResolvedValue([]));

      poller.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(0);
      const afterBoot = getInstances.mock.calls.length;
      expect(afterBoot).toBe(2);

      await jest.advanceTimersByTimeAsync(UPSTREAM_POLL_INTERVAL_MS);
      expect(getInstances.mock.calls.length).toBe(afterBoot * 2);

      poller.onApplicationShutdown();
      await jest.advanceTimersByTimeAsync(UPSTREAM_POLL_INTERVAL_MS * 3);
      expect(getInstances.mock.calls.length).toBe(afterBoot * 2);
    });
  });
});
