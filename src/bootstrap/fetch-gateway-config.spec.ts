import { fetchGatewayConfig, ConfigServerError } from './fetch-gateway-config';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const validPayload = {
  jwt: {
    publicKey: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----',
  },
  eureka: { serviceUrl: 'http://eureka:8761/eureka' },
  routing: { prefixes: { '/forms': 'expo-form-server' } },
};

describe('fetchGatewayConfig', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses a valid 200 response', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, validPayload));

    const config = await fetchGatewayConfig(
      'http://config-server:8888',
      'local',
    );

    expect(config.jwt.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://config-server:8888/configs/gateway/local',
    );
  });

  it('strips a trailing slash from the base URL', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(200, validPayload));

    await fetchGatewayConfig('http://config-server:8888/', 'local');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://config-server:8888/configs/gateway/local',
    );
  });

  it('rejects on a 404 (undefined profile)', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(404, { message: 'not found' }));

    await expect(
      fetchGatewayConfig('http://config-server:8888', 'nonexistent'),
    ).rejects.toThrow(ConfigServerError);
  });

  it('rejects on a 503 (Vault unavailable)', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse(503, { message: 'unavailable' }));

    await expect(
      fetchGatewayConfig('http://config-server:8888', 'local'),
    ).rejects.toThrow(ConfigServerError);
  });

  it('rejects on a network error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      fetchGatewayConfig('http://config-server:8888', 'local'),
    ).rejects.toThrow(ConfigServerError);
  });
});
