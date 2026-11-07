import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { CalculatorService } from './calculator.service';
import { Operation } from './calculator.types';

const SAFE_RANGE =
  'Operation result exceeds the safe range of -9007199254740991 to 9007199254740991';

describe('CalculatorService', () => {
  let service: CalculatorService;
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  };

  beforeEach(async () => {
    logger.info.mockReset();
    logger.warn.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CalculatorService,
        { provide: getLoggerToken(CalculatorService.name), useValue: logger },
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
  ])('%s(%s, %s) is %s', (operation, termOne, termTwo, result) => {
    expect(service.calculate(operation, termOne, termTwo)).toBe(result);
    expect(logger.info).toHaveBeenCalledWith(
      { operation, termOne, termTwo, result },
      'Calculation completed',
    );
  });

  it('rejects division by zero, including negative zero', () => {
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
  });

  it('rejects a result outside the safe integer range', () => {
    expect(() => service.calculate(Operation.Sum, 9007199254740991, 1)).toThrow(
      new BadRequestException(SAFE_RANGE),
    );
    expect(() => service.calculate(Operation.Sub, -9007199254740991, 1)).toThrow(SAFE_RANGE);
    expect(() => service.calculate(Operation.Mul, 3000000000, 4000000000)).toThrow(SAFE_RANGE);
    expect(() => service.calculate(Operation.Mul, Number.MAX_VALUE, 2)).toThrow(SAFE_RANGE);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('rejects a result too small to be represented exactly', () => {
    expect(() => service.calculate(Operation.Mul, 1e-200, 1e-200)).toThrow(
      new BadRequestException('Operation result is too small to be represented exactly'),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('rejects an operation outside the enum', () => {
    expect(() => service.calculate('pow' as Operation, 1, 2)).toThrow('Unsupported operation: pow');
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
