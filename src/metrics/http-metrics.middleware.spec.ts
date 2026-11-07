import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import { HttpMetricResponse, HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsService } from './metrics.service';

describe('HttpMetricsMiddleware', () => {
  let metrics: MetricsService;
  let middleware: HttpMetricsMiddleware;

  beforeEach(() => {
    metrics = new MetricsService(configService());
    middleware = new HttpMetricsMiddleware(metrics);
  });

  it('records the matched route template and the duration', async () => {
    const sum = fakeResponse(200);
    middleware.use(
      {
        method: 'GET',
        originalUrl: '/api/sum?term_one=2&term_two=3',
        baseUrl: '/api',
        route: { path: '/sum' },
      },
      sum,
      () => undefined,
    );
    const ready = fakeResponse(200);
    middleware.use(
      {
        method: 'GET',
        originalUrl: '/health/ready',
        baseUrl: '',
        route: { path: '/health/ready' },
      },
      ready,
      () => undefined,
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    sum.emit('finish');
    ready.emit('finish');

    const requests = await metrics.httpRequestsTotal.get();
    expect(requests.values).toEqual([
      { value: 1, labels: { method: 'GET', route: '/api/sum', status_code: '200' } },
      { value: 1, labels: { method: 'GET', route: '/health/ready', status_code: '200' } },
    ]);

    const durations = await metrics.httpRequestDurationSeconds.get();
    const sumDuration = durations.values.find(
      (sample) =>
        sample.metricName === 'http_request_duration_seconds_sum' &&
        sample.labels.route === '/api/sum',
    );
    const sumCount = durations.values.find(
      (sample) =>
        sample.metricName === 'http_request_duration_seconds_count' &&
        sample.labels.route === '/api/sum',
    );
    expect(sumCount?.value).toBe(1);
    expect(sumDuration?.value).toBeGreaterThan(0);

    const text = await metrics.scrape();
    expect(text).not.toContain('term_one');
    expect(text).not.toContain('term_two');
    expect(text).not.toContain('?');
  });

  it('records unmatched when the request has no route', async () => {
    const response = fakeResponse(404);
    const next = jest.fn();
    middleware.use(
      {
        method: 'GET',
        originalUrl: '/missing?q=secret',
        baseUrl: '',
      },
      response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    response.emit('finish');

    const requests = await metrics.httpRequestsTotal.get();
    expect(requests.values).toEqual([
      { value: 1, labels: { method: 'GET', route: 'unmatched', status_code: '404' } },
    ]);
    const text = await metrics.scrape();
    expect(text).not.toContain('secret');
    expect(text).not.toContain('missing');
    expect(text).not.toContain('?');
  });

  it('records a request only once when invoked twice', async () => {
    const response = fakeResponse(200);
    const request = {
      method: 'GET',
      originalUrl: '/api/sum',
      baseUrl: '',
      route: { path: '/api/sum' },
    };
    const next = jest.fn();
    middleware.use(request, response, next);
    middleware.use(request, response, next);
    response.emit('finish');

    expect(next).toHaveBeenCalledTimes(2);
    expect((await metrics.httpRequestsTotal.get()).values).toEqual([
      { value: 1, labels: { method: 'GET', route: '/api/sum', status_code: '200' } },
    ]);
  });

  it('does not record scrapes of /metrics', async () => {
    const plain = fakeResponse(200);
    const queried = fakeResponse(200);
    const next = jest.fn();
    middleware.use(
      {
        method: 'GET',
        originalUrl: '/metrics',
        baseUrl: '',
        route: { path: '/metrics' },
      },
      plain,
      next,
    );
    middleware.use(
      {
        method: 'GET',
        originalUrl: '/metrics?job=calculador',
        baseUrl: '',
        route: { path: '/metrics' },
      },
      queried,
      next,
    );
    plain.emit('finish');
    queried.emit('finish');

    expect(next).toHaveBeenCalledTimes(2);
    expect((await metrics.httpRequestsTotal.get()).values).toEqual([]);
    expect((await metrics.httpRequestDurationSeconds.get()).values).toEqual([]);
  });
});

function fakeResponse(statusCode: number): EventEmitter & HttpMetricResponse {
  const response = new EventEmitter() as EventEmitter & HttpMetricResponse;
  response.statusCode = statusCode;
  return response;
}

function configService(): ConfigService {
  const values: Record<string, string | number | boolean> = {
    port: 8000,
    nodeEnv: 'test',
    logLevel: 'silent',
    swaggerEnabled: false,
    serviceName: 'metrics-spec',
    version: '9.9.9',
    healthHeapThresholdMb: 200,
  };
  return {
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}
