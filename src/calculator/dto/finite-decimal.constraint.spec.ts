import { ValidationArguments } from 'class-validator';
import { FiniteDecimalConstraint } from './finite-decimal.constraint';

describe('FiniteDecimalConstraint', () => {
  const constraint = new FiniteDecimalConstraint();

  it('accepts only finite numbers', () => {
    expect(constraint.validate(0)).toBe(true);
    expect(constraint.validate(-3.5)).toBe(true);
    expect(constraint.validate(Number.POSITIVE_INFINITY)).toBe(false);
    expect(constraint.validate(Number.NaN)).toBe(false);
    expect(constraint.validate('1')).toBe(false);
  });

  it.each([
    [undefined, 'term_one is required'],
    [null, 'term_one is required'],
    ['', 'term_one is required'],
    ['abc', 'term_one must be a finite decimal number'],
    [' ', 'term_one must be a finite decimal number'],
  ])('describes %s as %s', (value, message) => {
    const args = { property: 'term_one', value } as ValidationArguments;
    expect(constraint.defaultMessage(args)).toBe(message);
  });

  it('uses a generic property name when arguments are missing', () => {
    expect(constraint.defaultMessage()).toBe('value is required');
  });
});
