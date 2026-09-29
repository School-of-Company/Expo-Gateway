import { readBootEnv, readInstanceEnv } from './env';

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
