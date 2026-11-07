import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { MetricsService } from '../metrics/metrics.service';
import { CalculatorService } from './calculator.service';
import { Operation } from './calculator.types';

const SAFE_RANGE =
  'Operation result exceeds the safe range of -9007199254740991 to 9007199254740991';

describe('CalculatorService', () => {
  let service: CalculatorService;
  let metrics: MetricsService;
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  };

  beforeEach(async () => {
    logger.info.mockReset();
    logger.warn.mockReset();
    metrics = new MetricsService(configService());
    const moduleRef = await Test.createTestingModule({
      providers: [
        CalculatorService,
        { provide: getLoggerToken(CalculatorService.name), useValue: logger },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();
    service = moduleRef.get(CalculatorService);
  });

  it.each([
    [Operation.Sum, 4, 1, 5],
    [Operation.Sub, 4, 1, 3],
    [Operation.Mul, 3, 5, 15],
    [Operation.Div, 5, 2, 2.5],
    [Operation.Sum, -3, 2.5, -0.5],
    [Operation.Mul, -2, -3, 6],
    [Operation.Div, -6, 2, -3],
    [Operation.Sub, 1, 1, 0],
    [Operation.Sum, 0.1, 0.2, 0.3],
    [Operation.Sub, 0.3, 0.1, 0.2],
    [Operation.Mul, 1.1, 1.1, 1.21],
    [Operation.Div, 0.3, 0.1, 3],
    [Operation.Div, 1, 3, 0.333333333333333],
    [Operation.Div, 2, 3, 0.666666666666667],
    [Operation.Sum, 9007199254740990, 1, 9007199254740991],
    [Operation.Div, 1, 1e-15, 1000000000000000],
  ])('%s(%s, %s) is %s', async (operation, termOne, termTwo, result) => {
    expect(service.calculate(operation, termOne, termTwo)).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      { operation, termOne, termTwo, result },
      'Calculation completed',
    );
    expect(await operationCount(metrics, operation, 'success')).toBe(1);
    expect(await operationCount(metrics, operation, 'rejected')).toBe(0);
  });

  it('rejects division by zero, including negative zero', async () => {
    expect(() => service.calculate(Operation.Div, 1, 0)).toThrow(
      new BadRequestException('Division by zero is not allowed'),
    );
    expect(() => service.calculate(Operation.Div, 1, -0)).toThrow(
      'Division by zero is not allowed',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { operation: Operation.Div, termOne: 1, termTwo: 0 },
      'Division by zero rejected',
    );
    expect(logger.info).not.toHaveBeenCalled();
    expect(await operationCount(metrics, Operation.Div, 'rejected')).toBe(2);
    expect(await operationCount(metrics, Operation.Div, 'success')).toBe(0);
  });

  it('rejects a result outside the safe integer range', async () => {
    expect(() => service.calculate(Operation.Sum, 9007199254740991, 1)).toThrow(
      new BadRequestException(SAFE_RANGE),
    );
    expect(() => service.calculate(Operation.Sub, -9007199254740991, 1)).toThrow(SAFE_RANGE);
    expect(() => service.calculate(Operation.Mul, 3000000000, 4000000000)).toThrow(SAFE_RANGE);
    expect(() => service.calculate(Operation.Mul, Number.MAX_VALUE, 2)).toThrow(SAFE_RANGE);
    expect(logger.info).not.toHaveBeenCalled();
    expect(await operationCount(metrics, Operation.Sum, 'rejected')).toBe(1);
    expect(await operationCount(metrics, Operation.Sub, 'rejected')).toBe(1);
    expect(await operationCount(metrics, Operation.Mul, 'rejected')).toBe(2);
    expect(await operationCount(metrics, Operation.Sum, 'success')).toBe(0);
  });

  it('rejects a result too small to be represented exactly', async () => {
    expect(() => service.calculate(Operation.Mul, 1e-200, 1e-200)).toThrow(
      new BadRequestException('Operation result is too small to be represented exactly'),
    );
    expect(logger.info).not.toHaveBeenCalled();
    expect(await operationCount(metrics, Operation.Mul, 'rejected')).toBe(1);
    expect(await operationCount(metrics, Operation.Mul, 'success')).toBe(0);
  });

  it('rejects an operation outside the enum', async () => {
    expect(() => service.calculate('pow' as Operation, 1, 2)).toThrow('Unsupported operation: pow');
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(await operationCount(metrics, 'pow', 'rejected')).toBe(1);
  });
});

async function operationCount(
  metrics: MetricsService,
  operation: string,
  result: 'success' | 'rejected',
): Promise<number> {
  const snapshot = await metrics.calculatorOperationsTotal.get();
  return (
    snapshot.values.find(
      (sample) => sample.labels.operation === operation && sample.labels.result === result,
    )?.value ?? 0
  );
}

function configService(): ConfigService {
  const values: Record<string, string | number | boolean> = {
    port: 8000,
    nodeEnv: 'test',
    logLevel: 'silent',
    swaggerEnabled: false,
    serviceName: 'calculador-api',
    version: '1.2.0',
    healthHeapThresholdMb: 200,
  };
  return {
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}
