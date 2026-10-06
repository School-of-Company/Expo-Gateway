import { readBootEnv, readInstanceEnv, readMetricsBind } from './env';

describe('readBootEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws when CONFIG_SERVER_URL is missing', () => {
    delete process.env.CONFIG_SERVER_URL;
    process.env.PROFILE = 'local';
    expect(() => readBootEnv()).toThrow(/CONFIG_SERVER_URL/);
  });

  it('throws when neither PROFILE nor NODE_ENV is set', () => {
    process.env.CONFIG_SERVER_URL = 'http://config-server:8888';
    delete process.env.PROFILE;
    delete process.env.NODE_ENV;
    expect(() => readBootEnv()).toThrow(/PROFILE/);
  });

  it('falls back to NODE_ENV when PROFILE is unset', () => {
    process.env.CONFIG_SERVER_URL = 'http://config-server:8888';
    delete process.env.PROFILE;
    process.env.NODE_ENV = 'test';
    expect(readBootEnv().profile).toBe('test');
  });
});

describe('readInstanceEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws when INSTANCE_HOSTNAME is missing', () => {
    delete process.env.INSTANCE_HOSTNAME;
    process.env.INSTANCE_IP_ADDR = '127.0.0.1';
    expect(() => readInstanceEnv()).toThrow(/INSTANCE_HOSTNAME/);
  });

  it('throws when INSTANCE_IP_ADDR is missing', () => {
    process.env.INSTANCE_HOSTNAME = 'localhost';
    delete process.env.INSTANCE_IP_ADDR;
    expect(() => readInstanceEnv()).toThrow(/INSTANCE_IP_ADDR/);
  });
});

describe('readMetricsBind', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.METRICS_HOST;
    delete process.env.METRICS_PORT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to loopback on 9464', () => {
    expect(readMetricsBind()).toEqual({ host: '127.0.0.1', port: 9464 });
  });

  it('reads host and port from the environment', () => {
    process.env.METRICS_HOST = '10.0.0.5';
    process.env.METRICS_PORT = '9100';
    expect(readMetricsBind()).toEqual({ host: '10.0.0.5', port: 9100 });
  });

  it('accepts port 0 (ephemeral)', () => {
    process.env.METRICS_PORT = '0';
    expect(readMetricsBind().port).toBe(0);
  });

  it.each(['', 'abc', '-1', '1.5', '65536', ' 9464'])(
    'rejects METRICS_PORT=%j',
    (value) => {
      process.env.METRICS_PORT = value;
      expect(() => readMetricsBind()).toThrow(/METRICS_PORT/);
    },
  );

  it('rejects an empty METRICS_HOST', () => {
    process.env.METRICS_HOST = '  ';
    expect(() => readMetricsBind()).toThrow(/METRICS_HOST/);
  });
});
