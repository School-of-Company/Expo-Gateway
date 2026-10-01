import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from '../metrics/metrics.service';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import type { RouteResolverService } from './route-resolver.service';

class FakeResponse extends EventEmitter {
  statusCode = 200;
  writableFinished = false;
}

function setup(resolve: (path: string) => string | undefined = () => 'a') {
  const metrics = new MetricsService();
  const resolver = { resolve } as unknown as RouteResolverService;
  const middleware = new HttpMetricsMiddleware(metrics, resolver);
  const res = new FakeResponse();
  const next = jest.fn() as NextFunction;
  const run = (url: string, method = 'GET') =>
    middleware.use(
      { method, originalUrl: url } as Request,
      res as unknown as Response,
      next,
    );
  const requestCounts = async () =>
    (await metrics.render())
      .split('\n')
      .filter((l) => l.startsWith('gateway_http_requests_total{'));
  return { res, run, next, requestCounts };
}

describe('HttpMetricsMiddleware', () => {
  it('calls next and records once when the response finishes', async () => {
    const { res, run, next, requestCounts } = setup();
    run('/forms/1?x=1');

    expect(next).toHaveBeenCalled();
    res.statusCode = 200;
    res.writableFinished = true;
    res.emit('finish');
    res.emit('close');

    expect(await requestCounts()).toEqual([
      'gateway_http_requests_total{method="GET",status="200",app="a"} 1',
    ]);
  });

  it('records 499 when the client closes before the response finished', async () => {
    const { res, run, requestCounts } = setup();
    run('/forms/1');

    res.writableFinished = false;
    res.emit('close');

    expect(await requestCounts()).toEqual([
      'gateway_http_requests_total{method="GET",status="499",app="a"} 1',
    ]);
  });

  it('labels unrouted paths as unmatched and gateway paths as gateway', async () => {
    const unrouted = setup(() => undefined);
    unrouted.run('/nope');
    unrouted.res.writableFinished = true;
    unrouted.res.statusCode = 404;
    unrouted.res.emit('finish');
    expect((await unrouted.requestCounts())[0]).toContain('app="unmatched"');

    const own = setup();
    own.run('/health');
    own.res.writableFinished = true;
    own.res.emit('finish');
    expect((await own.requestCounts())[0]).toContain('app="gateway"');
  });

  it('resolves the app from the path without the query string', () => {
    const seen: string[] = [];
    const { res, run } = setup((path) => {
      seen.push(path);
      return 'a';
    });
    run('/forms/1?token=secret');
    res.writableFinished = true;
    res.emit('finish');

    expect(seen).toEqual(['/forms/1']);
  });
});
