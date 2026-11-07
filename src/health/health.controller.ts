import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { DEFAULT_HEALTH_HEAP_THRESHOLD_MB } from '../config/app-config';
import { HealthStatusDto } from './dto/health-status.dto';

const BYTES_PER_MIB = 1024 * 1024;

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly heapThresholdBytes: number;

  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    configService: ConfigService,
  ) {
    this.heapThresholdBytes =
      configService.getOrThrow<number>('healthHeapThresholdMb') * BYTES_PER_MIB;
  }

  @Get('live')
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Cheap process check with no dependency or memory inspection.',
  })
  @ApiOkResponse({ type: HealthStatusDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  liveness() {
    return this.health.check([() => ({ process: { status: 'up' } })]);
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe',
    description: `Fails when the Node.js heap used exceeds HEALTH_HEAP_THRESHOLD_MB (default ${DEFAULT_HEALTH_HEAP_THRESHOLD_MB} MiB).`,
  })
  @ApiOkResponse({ type: HealthStatusDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  readiness() {
    return this.health.check([() => this.memory.checkHeap('memory_heap', this.heapThresholdBytes)]);
  }
}
