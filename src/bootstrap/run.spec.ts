import { runBootstrap } from './run';
import { fetchGatewayConfig } from './fetch-gateway-config';
import { resetGatewayConfigForTests } from './gateway-config-holder';
import { NestFactory } from '@nestjs/core';

jest.mock('./fetch-gateway-config');
jest.mock('@nestjs/core', () => ({
  NestFactory: { create: jest.fn() },
}));

const mockedFetch = fetchGatewayConfig as jest.MockedFunction<
  typeof fetchGatewayConfig
>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- NestFactory is jest.mock()'d above into a plain object of jest.fn()s, not a real class with `this`-bound methods.
const mockedCreate = NestFactory.create as jest.Mock;

describe('runBootstrap', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CONFIG_SERVER_URL = 'http://config-server:8888';
    process.env.PROFILE = 'local';
    delete process.env.PORT;
    mockedFetch.mockReset();
    mockedCreate.mockReset();
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

  it('calls NestFactory.create after a successful config fetch', async () => {
    mockedFetch.mockResolvedValue({
      jwt: { publicKey: 'pem' },
      eureka: { serviceUrl: 'http://eureka:8761/eureka' },
      routing: { prefixes: { '/forms': 'expo-form-server' } },
    });
    const fakeApp = {
      enableShutdownHooks: jest.fn(),
      getHttpAdapter: () => ({ getInstance: () => ({ set: jest.fn() }) }),
      listen: jest.fn().mockResolvedValue(undefined),
    };
    mockedCreate.mockResolvedValue(fakeApp);
    const exit = jest.fn();

    await runBootstrap(exit);

    expect(exit).not.toHaveBeenCalled();
    expect(mockedCreate).toHaveBeenCalled();
    expect(fakeApp.enableShutdownHooks).toHaveBeenCalled();
    expect(fakeApp.listen).toHaveBeenCalledWith(3000);
  });
});
