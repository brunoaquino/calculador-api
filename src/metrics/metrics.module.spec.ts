import { RequestMethod } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { NextFunction } from 'express';
import {
  HttpMetricRequest,
  HttpMetricResponse,
  HttpMetricsMiddleware,
} from './http-metrics.middleware';
import { HttpMetricsRegistrar, MetricsModule } from './metrics.module';

describe('MetricsModule', () => {
  it('applies HTTP metrics middleware to every route', () => {
    const forRoutes = jest.fn();
    const apply = jest.fn().mockReturnValue({ forRoutes });
    const module = new MetricsModule();

    module.configure({ apply });

    expect(apply).toHaveBeenCalledWith(HttpMetricsMiddleware);
    expect(forRoutes).toHaveBeenCalledWith({ path: '{*path}', method: RequestMethod.ALL });
  });
});

describe('HttpMetricsRegistrar', () => {
  it('mounts the middleware on the express app', () => {
    const use = jest.fn();
    const middleware = { use: jest.fn() };
    const registrar = new HttpMetricsRegistrar(
      { httpAdapter: { getInstance: () => ({ use }) } } as unknown as HttpAdapterHost,
      middleware as unknown as HttpMetricsMiddleware,
    );

    registrar.onModuleInit();

    expect(use).toHaveBeenCalledTimes(1);
    const handler = use.mock.calls[0][0] as (
      request: HttpMetricRequest,
      response: HttpMetricResponse,
      next: NextFunction,
    ) => void;
    const request: HttpMetricRequest = { method: 'GET', originalUrl: '/nope', baseUrl: '' };
    const response: HttpMetricResponse = { statusCode: 404, on: jest.fn() };
    const next = jest.fn();
    handler(request, response, next);
    expect(middleware.use).toHaveBeenCalledWith(request, response, next);
  });
});
