import { ConfigService } from '@nestjs/config';
import { register as globalRegistry } from 'prom-client';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService(configService());
  });

  it('keeps a dedicated registry with service and version labels', async () => {
    expect(service.registry).not.toBe(globalRegistry);
    expect(globalRegistry.getSingleMetric('http_requests_total')).toBeUndefined();
    expect(globalRegistry.getSingleMetric('calculator_operations_total')).toBeUndefined();
    expect(service.contentType).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(service.contentType).toBe(service.registry.contentType);

    const names = service.registry.getMetricsAsArray().map((metric) => metric.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'process_cpu_seconds_total',
        'process_resident_memory_bytes',
        'nodejs_heap_size_total_bytes',
        'nodejs_eventloop_lag_seconds',
        'nodejs_gc_duration_seconds',
        'http_requests_total',
        'http_request_duration_seconds',
        'calculator_operations_total',
      ]),
    );
    const text = await service.scrape();
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('# TYPE http_request_duration_seconds histogram');
    expect(text).toContain('# TYPE calculator_operations_total counter');
    const memory = text
      .split('\n')
      .find((line) => line.startsWith('process_resident_memory_bytes'));
    expect(memory).toContain('service="metrics-spec"');
    expect(memory).toContain('version="9.9.9"');
  });

  it('registers the http counter and histogram buckets', async () => {
    service.recordHttpRequest({ method: 'GET', route: '/api/sum', status_code: '200' }, 0.02);

    const text = await service.scrape();
    const bounds = text
      .split('\n')
      .filter((line) => line.startsWith('http_request_duration_seconds_bucket{'))
      .map((line) => bucketBound(line));
    expect(bounds).toEqual([
      '0.005',
      '0.01',
      '0.025',
      '0.05',
      '0.1',
      '0.25',
      '0.5',
      '1',
      '2.5',
      '+Inf',
    ]);

    const requests = await service.httpRequestsTotal.get();
    expect(requests.values).toEqual([
      { value: 1, labels: { method: 'GET', route: '/api/sum', status_code: '200' } },
    ]);
  });

  it('increments calculator operations by outcome', async () => {
    service.recordCalculatorOperation('sum', 'success');
    service.recordCalculatorOperation('sum', 'success');
    service.recordCalculatorOperation('div', 'rejected');

    const snapshot = await service.calculatorOperationsTotal.get();
    expect(snapshot.values).toEqual([
      { value: 2, labels: { operation: 'sum', result: 'success' } },
      { value: 1, labels: { operation: 'div', result: 'rejected' } },
    ]);

    const text = await service.scrape();
    expect(text).toContain('service="metrics-spec"');
    expect(text).toContain('version="9.9.9"');
    expect(text).toContain('operation="sum"');
    expect(text).toContain('result="rejected"');
  });

  it('does not share counters across registries', async () => {
    const other = new MetricsService(configService('other-service', '0.1.0'));
    other.recordCalculatorOperation('mul', 'success');

    expect((await service.calculatorOperationsTotal.get()).values).toEqual([]);
    expect((await other.calculatorOperationsTotal.get()).values).toEqual([
      { value: 1, labels: { operation: 'mul', result: 'success' } },
    ]);

    const text = await other.scrape();
    expect(text).toContain('service="other-service"');
    expect(text).toContain('version="0.1.0"');
    expect(text).not.toContain('service="metrics-spec"');
  });
});

function bucketBound(line: string): string {
  const match = /le="([^"]+)"/.exec(line);
  if (!match?.[1]) {
    throw new Error(`missing bucket label in ${line}`);
  }
  return match[1];
}

function configService(serviceName = 'metrics-spec', version = '9.9.9'): ConfigService {
  const values: Record<string, string | number | boolean> = {
    port: 8000,
    nodeEnv: 'test',
    logLevel: 'silent',
    swaggerEnabled: false,
    serviceName,
    version,
    healthHeapThresholdMb: 200,
  };
  return {
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}
