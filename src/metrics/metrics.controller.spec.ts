import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('MetricsController', () => {
  it('responds with the registry content type and body', async () => {
    const metrics = new MetricsService(configService());
    const controller = new MetricsController(metrics);
    const response = {
      statusCode: 0,
      setHeader: jest.fn(),
      end: jest.fn(),
    };

    await controller.scrape(response as unknown as Response);

    expect(response.statusCode).toBe(200);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', metrics.contentType);
    expect(metrics.contentType).toBe('text/plain; version=0.0.4; charset=utf-8');
    const body = response.end.mock.calls[0]?.[0] as string;
    expect(body).toContain('process_resident_memory_bytes');
    expect(body).toContain('service="metrics-spec"');
    expect(body).toContain('version="9.9.9"');
  });
});

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
