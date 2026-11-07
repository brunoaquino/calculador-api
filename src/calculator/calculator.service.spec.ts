import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getLoggerToken } from 'nestjs-pino';
import { CalculatorService } from './calculator.service';
import { Operation } from './calculator.types';

describe('CalculatorService', () => {
  let service: CalculatorService;
  const logger = {
    debug: jest.fn(),
    warn: jest.fn(),
  };

  beforeEach(async () => {
    logger.debug.mockReset();
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
  ])('%s(%s, %s) is %s', (operation, termOne, termTwo, result) => {
    expect(service.calculate(operation, termOne, termTwo)).toBe(result);
    expect(logger.debug).toHaveBeenCalledWith(
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
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('rejects a non-finite result', () => {
    expect(() => service.calculate(Operation.Mul, Number.MAX_VALUE, 2)).toThrow(
      'Operation result is not a finite number',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      {
        operation: Operation.Mul,
        termOne: Number.MAX_VALUE,
        termTwo: 2,
        result: Number.POSITIVE_INFINITY,
      },
      'Non-finite calculation result rejected',
    );
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('rejects an operation outside the enum', () => {
    expect(() => service.calculate('pow' as Operation, 1, 2)).toThrow('Unsupported operation: pow');
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
