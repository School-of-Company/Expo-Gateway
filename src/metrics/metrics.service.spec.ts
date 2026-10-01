import { MetricsService, statusClass } from './metrics.service';

async function lines(metrics: MetricsService): Promise<string[]> {
  return (await metrics.render()).split('\n');
}

function value(all: string[], series: string): number | undefined {
  const line = all.find((l) => l.startsWith(`${series} `));
  return line ? Number(line.slice(series.length + 1)) : undefined;
}

describe('statusClass', () => {
  it('maps a status to its class', () => {
    expect(statusClass(200)).toBe('2xx');
    expect(statusClass(404)).toBe('4xx');
    expect(statusClass(499)).toBe('4xx');
    expect(statusClass(503)).toBe('5xx');
  });
});

describe('MetricsService', () => {
  it('counts requests by method, status and app', async () => {
    const metrics = new MetricsService();
    metrics.recordRequest('GET', 200, 'expo-form-server', 0.01);
    metrics.recordRequest('GET', 200, 'expo-form-server', 0.02);
    metrics.recordRequest('GET', 502, 'expo-form-server', 0.03);

    const all = await lines(metrics);
    expect(
      value(
        all,
        'gateway_http_requests_total{method="GET",status="200",app="expo-form-server"}',
      ),
    ).toBe(2);
    expect(
      value(
        all,
        'gateway_http_requests_total{method="GET",status="502",app="expo-form-server"}',
      ),
    ).toBe(1);
  });

  it('collapses non-standard methods into OTHER to bound cardinality', async () => {
    const metrics = new MetricsService();
    metrics.recordRequest('FOO', 200, 'gateway', 0.01);
    metrics.recordRequest('BAR', 200, 'gateway', 0.01);

    const all = await lines(metrics);
    expect(
      value(
        all,
        'gateway_http_requests_total{method="OTHER",status="200",app="gateway"}',
      ),
    ).toBe(2);
  });

  it('splits request duration by status class', async () => {
    const metrics = new MetricsService();
    metrics.recordRequest('GET', 200, 'a', 0.01);
    metrics.recordRequest('GET', 401, 'a', 0.001);

    const all = await lines(metrics);
    expect(
      value(
        all,
        'gateway_http_request_duration_seconds_count{app="a",status_class="2xx"}',
      ),
    ).toBe(1);
    expect(
      value(
        all,
        'gateway_http_request_duration_seconds_count{app="a",status_class="4xx"}',
      ),
    ).toBe(1);
  });

  it('records upstream duration without a status label', async () => {
    const metrics = new MetricsService();
    metrics.observeUpstream('a', 0.02);

    const all = await lines(metrics);
    expect(value(all, 'gateway_upstream_duration_seconds_count{app="a"}')).toBe(
      1,
    );
  });

  it('sets and clears the healthy-instances gauge', async () => {
    const metrics = new MetricsService();
    metrics.setHealthyInstances('a', 3);
    expect(
      value(
        await lines(metrics),
        'gateway_upstream_healthy_instances{app="a"}',
      ),
    ).toBe(3);

    metrics.clearHealthyInstances('a');
    expect(
      value(
        await lines(metrics),
        'gateway_upstream_healthy_instances{app="a"}',
      ),
    ).toBeUndefined();
  });

  it('includes default process metrics and exposes a content type', async () => {
    const metrics = new MetricsService();
    expect(await metrics.render()).toContain('process_cpu_user_seconds_total');
    expect(metrics.contentType).toContain('text/plain');
  });

  it('keeps registries independent between instances', async () => {
    const first = new MetricsService();
    const second = new MetricsService();
    first.recordRequest('GET', 200, 'a', 0.01);

    expect(
      value(
        await lines(second),
        'gateway_http_requests_total{method="GET",status="200",app="a"}',
      ),
    ).toBeUndefined();
  });
});
