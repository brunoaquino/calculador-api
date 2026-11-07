import { ValidationArguments } from 'class-validator';
import { FiniteDecimalConstraint } from './finite-decimal.constraint';
import { OperandRejection } from './parse-finite-number';

describe('FiniteDecimalConstraint', () => {
  const constraint = new FiniteDecimalConstraint();

  it('accepts only finite numbers', () => {
    expect(constraint.validate(0)).toBe(true);
    expect(constraint.validate(-3.5)).toBe(true);
    expect(constraint.validate(Number.POSITIVE_INFINITY)).toBe(false);
    expect(constraint.validate(Number.NaN)).toBe(false);
    expect(constraint.validate('1')).toBe(false);
    expect(constraint.validate(new OperandRejection('range'))).toBe(false);
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

  it.each([
    ['range', 'term_one must be between -9007199254740991 and 9007199254740991'],
    ['underflow', 'term_one underflows to zero'],
    ['precision', 'term_one has more significant digits than a 64-bit float can represent exactly'],
  ] as const)('describes a %s rejection as %s', (reason, message) => {
    const args = {
      property: 'term_one',
      value: new OperandRejection(reason),
    } as ValidationArguments;
    expect(constraint.defaultMessage(args)).toBe(message);
  });

  it('uses a generic property name when arguments are missing', () => {
    expect(constraint.defaultMessage()).toBe('value is required');
  });

  it('fails closed when the rejection reason is unknown', () => {
    const rejection = new OperandRejection('range');
    Object.assign(rejection, { reason: 'other' });
    const args = { property: 'term_one', value: rejection } as ValidationArguments;

    expect(() => constraint.defaultMessage(args)).toThrow('Unsupported operand rejection: other');
  });
});
