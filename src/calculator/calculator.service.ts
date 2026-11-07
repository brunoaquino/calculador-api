import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ExactDecimal, SAFE_INTEGER_LIMIT } from './exact-decimal';
import { Operation } from './calculator.types';

type ExactNumber = InstanceType<typeof ExactDecimal>;

@Injectable()
export class CalculatorService {
  constructor(
    @InjectPinoLogger(CalculatorService.name)
    private readonly logger: PinoLogger,
  ) {}

  calculate(operation: Operation, termOne: number, termTwo: number): number {
    const result = toJsonNumber(this.evaluate(operation, termOne, termTwo));
    this.logger.info({ operation, termOne, termTwo, result }, 'Calculation completed');
    return result;
  }

  private evaluate(operation: Operation, termOne: number, termTwo: number): ExactNumber {
    const left = new ExactDecimal(termOne);
    const right = new ExactDecimal(termTwo);

    switch (operation) {
      case Operation.Sum:
        return left.plus(right);
      case Operation.Sub:
        return left.minus(right);
      case Operation.Mul:
        return left.times(right);
      case Operation.Div: {
        if (termTwo === 0) {
          this.logger.warn({ operation, termOne, termTwo }, 'Division by zero rejected');
          throw new BadRequestException('Division by zero is not allowed');
        }
        return left.dividedBy(right);
      }
      default: {
        const unsupported: never = operation;
        throw new BadRequestException(`Unsupported operation: ${String(unsupported)}`);
      }
    }
  }
}

function toJsonNumber(value: ExactNumber): number {
  const finalized = value.isInteger() ? value : value.toSignificantDigits(15);
  if (finalized.abs().greaterThan(SAFE_INTEGER_LIMIT)) {
    throw new BadRequestException(
      `Operation result exceeds the safe range of -${SAFE_INTEGER_LIMIT} to ${SAFE_INTEGER_LIMIT}`,
    );
  }

  const serialized = finalized.toString();
  const roundTrip = new ExactDecimal(String(Number(serialized)));
  if (!finalized.isZero() && !roundTrip.equals(finalized)) {
    throw new BadRequestException('Operation result is too small to be represented exactly');
  }

  return Number(serialized);
}
