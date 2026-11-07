import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction } from 'express';
import { MetricsService } from './metrics.service';

const METRICS_PATH = '/metrics';
const UNMATCHED_ROUTE = 'unmatched';
const observedRequests = new WeakSet<object>();

export interface HttpMetricRequest {
  method: string;
  originalUrl: string;
  baseUrl: string;
  route?: { path?: string };
}

export interface HttpMetricResponse {
  statusCode: number;
  on(event: 'finish', listener: () => void): void;
}

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware<
  HttpMetricRequest,
  HttpMetricResponse
> {
  constructor(private readonly metrics: MetricsService) {}

  use(request: HttpMetricRequest, response: HttpMetricResponse, next: NextFunction): void {
    if (observedRequests.has(request)) {
      next();
      return;
    }
    observedRequests.add(request);

    if (pathnameOf(request.originalUrl) === METRICS_PATH) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      this.metrics.recordHttpRequest(
        {
          method: request.method,
          route: routeOf(request),
          status_code: String(response.statusCode),
        },
        durationSeconds,
      );
    });
    next();
  }
}

function pathnameOf(url: string): string {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) {
    return url;
  }

  return url.slice(0, queryIndex);
}

// Templates only: req.route.path is the matched pattern and baseUrl is the mount path.
function routeOf(request: HttpMetricRequest): string {
  const routePath = request.route?.path;
  if (routePath === undefined) {
    return UNMATCHED_ROUTE;
  }

  return `${request.baseUrl}${routePath}`;
}
