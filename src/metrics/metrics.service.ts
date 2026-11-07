import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import { getAppConfig } from '../config/app-config';

const HTTP_LABELS = ['method', 'route', 'status_code'] as const;
const CALCULATOR_LABELS = ['operation', 'result'] as const;
const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

export interface HttpRequestLabels {
  method: string;
  route: string;
  status_code: string;
}

export type CalculatorMetricResult = 'success' | 'rejected';

@Injectable()
export class MetricsService {
  readonly registry: Registry;
  readonly httpRequestsTotal: Counter<(typeof HTTP_LABELS)[number]>;
  readonly httpRequestDurationSeconds: Histogram<(typeof HTTP_LABELS)[number]>;
  readonly calculatorOperationsTotal: Counter<(typeof CALCULATOR_LABELS)[number]>;

  constructor(configService: ConfigService) {
    const config = getAppConfig(configService);
    this.registry = new Registry();
    this.registry.setDefaultLabels({
      service: config.serviceName,
      version: config.version,
    });
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests by method, route template and status code, excluding /metrics scrapes.',
      labelNames: HTTP_LABELS,
      registers: [this.registry],
    });
    this.httpRequestDurationSeconds = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds by method, route template and status code. Excludes /metrics.',
      labelNames: HTTP_LABELS,
      buckets: HTTP_DURATION_BUCKETS,
      registers: [this.registry],
    });
    this.calculatorOperationsTotal = new Counter({
      name: 'calculator_operations_total',
      help: 'Calculator operations by kind and outcome. rejected means the service threw.',
      labelNames: CALCULATOR_LABELS,
      registers: [this.registry],
    });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  scrape(): Promise<string> {
    return this.registry.metrics();
  }

  recordHttpRequest(labels: HttpRequestLabels, durationSeconds: number): void {
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDurationSeconds.observe(labels, durationSeconds);
  }

  recordCalculatorOperation(operation: string, result: CalculatorMetricResult): void {
    this.calculatorOperationsTotal.inc({ operation, result });
  }
}
