import { runBootstrap } from './run';
import { GATEWAY_APP_OPTIONS } from './app-options';
import { fetchGatewayConfig } from './fetch-gateway-config';
import { resetGatewayConfigForTests } from './gateway-config-holder';
import { NestFactory } from '@nestjs/core';
import { startMetricsServer } from '../metrics/metrics.server';

jest.mock('./fetch-gateway-config');
jest.mock('../metrics/metrics.server');
jest.mock('@nestjs/core', () => ({
  NestFactory: { create: jest.fn() },
}));

const mockedFetch = fetchGatewayConfig as jest.MockedFunction<
  typeof fetchGatewayConfig
>;
const mockedStartMetrics = startMetricsServer as jest.MockedFunction<
  typeof startMetricsServer
>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- NestFactory is jest.mock()'d above into a plain object of jest.fn()s, not a real class with `this`-bound methods.
const mockedCreate = NestFactory.create as jest.Mock;

const validConfig = {
  jwt: { publicKey: 'pem' },
  eureka: { serviceUrl: 'http://eureka:8761/eureka' },
  routing: { prefixes: { '/forms': 'expo-form-server' } },
};

function makeFakeApp() {
  const publicServer = { once: jest.fn() };
  return {
    publicServer,
    app: {
      enableShutdownHooks: jest.fn(),
      getHttpAdapter: () => ({ getInstance: () => ({ set: jest.fn() }) }),
      getHttpServer: () => publicServer,
      get: jest.fn().mockReturnValue({ metrics: true }),
      listen: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('runBootstrap', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CONFIG_SERVER_URL = 'http://config-server:8888';
    process.env.PROFILE = 'local';
    delete process.env.PORT;
    delete process.env.METRICS_HOST;
    delete process.env.METRICS_PORT;
    mockedFetch.mockReset();
    mockedCreate.mockReset();
    mockedStartMetrics.mockReset();
    resetGatewayConfigForTests();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('exits with code 1 and never calls NestFactory.create when the config fetch fails', async () => {
    mockedFetch.mockRejectedValue(new Error('Config Server unreachable'));
    const exit = jest.fn();

    await runBootstrap(exit);

    expect(exit).toHaveBeenCalledWith(1);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('fails fast on a malformed METRICS_PORT before touching the network', async () => {
    process.env.METRICS_PORT = 'abc';

    await expect(runBootstrap(jest.fn())).rejects.toThrow(/METRICS_PORT/);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('calls NestFactory.create and starts the metrics server after a successful config fetch', async () => {
    mockedFetch.mockResolvedValue(validConfig);
    const { app, publicServer } = makeFakeApp();
    const metricsServer = { close: jest.fn() };
    mockedCreate.mockResolvedValue(app);
    mockedStartMetrics.mockResolvedValue(metricsServer as never);
    const exit = jest.fn();

    await runBootstrap(exit);

    expect(exit).not.toHaveBeenCalled();
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.anything(),
      GATEWAY_APP_OPTIONS,
    );
    expect(app.enableShutdownHooks).toHaveBeenCalled();
    expect(app.listen).toHaveBeenCalledWith(3000);
    expect(mockedStartMetrics).toHaveBeenCalledWith(
      { metrics: true },
      9464,
      '127.0.0.1',
    );

    const onClose = publicServer.once.mock.calls[0] as [string, () => void];
    expect(onClose[0]).toBe('close');
    onClose[1]();
    expect(metricsServer.close).toHaveBeenCalled();
  });

  it('keeps serving when the metrics server cannot bind', async () => {
    mockedFetch.mockResolvedValue(validConfig);
    const { app } = makeFakeApp();
    mockedCreate.mockResolvedValue(app);
    mockedStartMetrics.mockRejectedValue(new Error('EADDRINUSE'));
    const exit = jest.fn();

    await expect(runBootstrap(exit)).resolves.toBeUndefined();

    expect(exit).not.toHaveBeenCalled();
    expect(app.listen).toHaveBeenCalled();
  });
});
