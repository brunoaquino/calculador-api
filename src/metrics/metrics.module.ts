import {
  Global,
  Injectable,
  MiddlewareConsumer,
  Module,
  NestModule,
  OnModuleInit,
  RequestMethod,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { NextFunction } from 'express';
import {
  HttpMetricRequest,
  HttpMetricResponse,
  HttpMetricsMiddleware,
} from './http-metrics.middleware';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

interface ExpressLikeApp {
  use(
    handler: (request: HttpMetricRequest, response: HttpMetricResponse, next: NextFunction) => void,
  ): void;
}

/**
 * forRoutes('{*path}') is limited to the global prefix and its exclusions.
 * This mount runs after those routers and before the not-found handler, so a
 * 404 outside /api is still observed.
 */
@Injectable()
export class HttpMetricsRegistrar implements OnModuleInit {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly middleware: HttpMetricsMiddleware,
  ) {}

  onModuleInit(): void {
    const server = this.httpAdapterHost.httpAdapter.getInstance<ExpressLikeApp>();
    server.use((request, response, next) => {
      this.middleware.use(request, response, next);
    });
  }
}

/** Global so any module can record metrics, while HTTP collection stays in this module. */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, HttpMetricsMiddleware, HttpMetricsRegistrar],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
