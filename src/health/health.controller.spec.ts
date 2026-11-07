import { ConfigService } from '@nestjs/config';
import { HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const check = jest.fn();
  const checkHeap = jest.fn();
  const getOrThrow = jest.fn().mockReturnValue(128);
  const controller = new HealthController(
    { check } as unknown as HealthCheckService,
    { checkHeap } as unknown as MemoryHealthIndicator,
    { getOrThrow } as unknown as ConfigService,
  );

  beforeEach(() => {
    check.mockReset();
    checkHeap.mockReset();
    check.mockImplementation(async (indicators: Array<() => unknown>) => {
      const results = await Promise.all(
        indicators.map((indicator) => Promise.resolve(indicator())),
      );
      return {
        status: 'ok',
        info: Object.assign({}, ...results),
        error: {},
        details: Object.assign({}, ...results),
      };
    });
  });

  it('reports the process as up without inspecting memory', async () => {
    await expect(controller.liveness()).resolves.toMatchObject({
      status: 'ok',
      details: { process: { status: 'up' } },
    });
    expect(checkHeap).not.toHaveBeenCalled();
  });

  it('checks the heap against the configured threshold', async () => {
    checkHeap.mockResolvedValue({ memory_heap: { status: 'up' } });

    await expect(controller.readiness()).resolves.toMatchObject({
      status: 'ok',
      details: { memory_heap: { status: 'up' } },
    });
    expect(getOrThrow).toHaveBeenCalledWith('healthHeapThresholdMb');
    expect(checkHeap).toHaveBeenCalledWith('memory_heap', 128 * 1024 * 1024);
  });
});
