import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { SAFE_INTEGER_LIMIT } from '../exact-decimal';
import { OperandRejection, type OperandRejectionReason } from './parse-finite-number';

@ValidatorConstraint({ name: 'finiteDecimal', async: false })
export class FiniteDecimalConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
  }

  defaultMessage(args?: ValidationArguments): string {
    const property = args?.property ?? 'value';
    const value: unknown = args?.value;
    if (value instanceof OperandRejection) {
      return rejectionMessage(property, value.reason);
    }

    if (value === undefined || value === null || value === '') {
      return `${property} is required`;
    }

    return `${property} must be a finite decimal number`;
  }
}

function rejectionMessage(property: string, reason: OperandRejectionReason): string {
  switch (reason) {
    case 'range':
      return `${property} must be between -${SAFE_INTEGER_LIMIT} and ${SAFE_INTEGER_LIMIT}`;
    case 'underflow':
      return `${property} underflows to zero`;
    case 'precision':
      return `${property} has more significant digits than a 64-bit float can represent exactly`;
    default: {
      const unsupported: never = reason;
      throw new Error(`Unsupported operand rejection: ${String(unsupported)}`);
    }
  }
}
