import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Operation } from './calculator.types';

@Injectable()
export class CalculatorService {
  constructor(
    @InjectPinoLogger(CalculatorService.name)
    private readonly logger: PinoLogger,
  ) {}

  calculate(operation: Operation, termOne: number, termTwo: number): number {
    let result: number;

    switch (operation) {
      case Operation.Sum:
        result = termOne + termTwo;
        break;
      case Operation.Sub:
        result = termOne - termTwo;
        break;
      case Operation.Mul:
        result = termOne * termTwo;
        break;
      case Operation.Div: {
        if (termTwo === 0) {
          this.logger.warn({ operation, termOne, termTwo }, 'Division by zero rejected');
          throw new BadRequestException('Division by zero is not allowed');
        }
        result = termOne / termTwo;
        break;
      }
      default: {
        const unsupported: never = operation;
        throw new BadRequestException(`Unsupported operation: ${String(unsupported)}`);
      }
    }

    if (!Number.isFinite(result)) {
      this.logger.warn(
        { operation, termOne, termTwo, result },
        'Non-finite calculation result rejected',
      );
      throw new BadRequestException('Operation result is not a finite number');
    }

    this.logger.debug({ operation, termOne, termTwo, result }, 'Calculation completed');
    return result;
  }
}
