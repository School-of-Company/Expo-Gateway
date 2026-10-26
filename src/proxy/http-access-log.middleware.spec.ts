import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { GatewayConfigService } from '../config/gateway-config.service';
import { HttpAccessLogMiddleware } from './http-access-log.middleware';
import type { RouteResolverService } from './route-resolver.service';

class FakeResponse extends EventEmitter {
  statusCode = 200;
  writableFinished = false;
}

function setup(
  resolve: (path: string) => string | undefined = () => 'expo-form',
  docsServiceUrls: string[] = [],
) {
  const middleware = new HttpAccessLogMiddleware(
    { resolve } as unknown as RouteResolverService,
    {
      getDocs: () =>
        docsServiceUrls.length > 0
          ? { enabled: true, services: docsServiceUrls.map((url) => ({ url })) }
          : undefined,
    } as unknown as GatewayConfigService,
  );
  const res = new FakeResponse();
  const next = jest.fn() as NextFunction;
  const run = (url: string, method = 'GET') =>
    middleware.use(
      { method, originalUrl: url } as Request,
      res as unknown as Response,
      next,
    );
  const finish = (status: number) => {
    res.statusCode = status;
    res.writableFinished = true;
    res.emit('finish');
    res.emit('close');
  };
  return { res, run, next, finish };
}

describe('HttpAccessLogMiddleware', () => {
  type LogSpy = jest.SpyInstance<void, [message: unknown, ...rest: unknown[]]>;
  let info: LogSpy;
  let warn: LogSpy;
  let error: LogSpy;

  beforeEach(() => {
    delete process.env.HTTP_ACCESS_LOG_ENABLED;
    info = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.HTTP_ACCESS_LOG_ENABLED;
  });

  it('logs once on finish as INFO, with the routed app', () => {
    const { run, next, finish } = setup();
    run('/expo/forms/123');
    expect(next).toHaveBeenCalled();
    finish(200);

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toMatch(
      /^GET \/expo\/forms\/123 status: 200 \(\d+ms\) -> expo-form$/,
    );
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('uses the HttpAccess logger context', () => {
    const { run, finish } = setup();
    run('/a');
    finish(200);
    expect((info.mock.contexts[0] as { context?: string }).context).toBe(
      'HttpAccess',
    );
  });

  it('logs 4xx as WARN and 5xx as ERROR', () => {
    const a = setup();
    a.run('/a', 'POST');
    a.finish(401);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^POST \/a status: 401 \(\d+ms\)/);

    const b = setup();
    b.run('/a');
    b.finish(502);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatch(/^GET \/a status: 502 \(\d+ms\)/);
  });

  it('logs 499 as ERROR when the client closes before the response finished', () => {
    const { res, run } = setup();
    run('/a');
    res.emit('close');
    res.emit('close');

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatch(/^GET \/a status: 499 \(\d+ms\)/);
    expect(info).not.toHaveBeenCalled();
  });

  it('omits the app suffix for unrouted paths', () => {
    const { run, finish } = setup(() => undefined);
    run('/nope');
    finish(404);
    expect(warn.mock.calls[0][0]).toMatch(/^GET \/nope status: 404 \(\d+ms\)$/);
  });

  it('never logs the query string', () => {
    const seen: string[] = [];
    const { run, finish } = setup((path) => {
      seen.push(path);
      return 'expo-user';
    });
    run('/users/me?phone=01012345678&token=secret');
    finish(200);

    const line = info.mock.calls[0][0] as string;
    expect(line).toMatch(
      /^GET \/users\/me status: 200 \(\d+ms\) -> expo-user$/,
    );
    expect(line).not.toContain('?');
    expect(line).not.toContain('secret');
    expect(seen).toEqual(['/users/me']);
  });

  it.each(['/health', '/docs', '/docs/swagger-ui.css', '/sms/v3/api-docs'])(
    'skips %s',
    (path) => {
      const { res, run, next, finish } = setup(undefined, ['/sms/v3/api-docs']);
      run(path);
      expect(next).toHaveBeenCalled();
      finish(200);
      expect(res.listenerCount('finish')).toBe(0);
      expect(info).not.toHaveBeenCalled();
    },
  );

  it('is turned off by HTTP_ACCESS_LOG_ENABLED=false', () => {
    process.env.HTTP_ACCESS_LOG_ENABLED = 'false';
    const { run, next, finish } = setup();
    run('/a');
    expect(next).toHaveBeenCalled();
    finish(500);
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
