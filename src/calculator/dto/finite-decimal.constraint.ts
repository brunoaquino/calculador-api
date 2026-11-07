import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'finiteDecimal', async: false })
export class FiniteDecimalConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
  }

  defaultMessage(args?: ValidationArguments): string {
    const property = args?.property ?? 'value';
    const value: unknown = args?.value;
    if (value === undefined || value === null || value === '') {
      return `${property} is required`;
    }

    return `${property} must be a finite decimal number`;
  }
}
