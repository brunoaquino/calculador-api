import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  @ApiOperation({
    operationId: 'metrics',
    summary: 'Prometheus metrics',
    description:
      'Prometheus text exposition at /metrics, outside the /api prefix. Scrapes are omitted from HTTP metrics and access logs.',
  })
  @ApiProduces('text/plain')
  @ApiOkResponse({
    description: 'Prometheus text exposition format.',
    content: {
      'text/plain': {
        schema: { type: 'string' },
      },
    },
  })
  async scrape(@Res() response: Response): Promise<void> {
    response.statusCode = 200;
    response.setHeader('Content-Type', this.metrics.contentType);
    response.end(await this.metrics.scrape());
  }
}
