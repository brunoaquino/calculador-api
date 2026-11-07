import { OperandRejection, parseFiniteNumber } from './parse-finite-number';

describe('parseFiniteNumber', () => {
  it.each([
    '0',
    '-0',
    '4',
    '-3',
    '2.5',
    '+2.5',
    '0.1',
    '1e2',
    '1e-1',
    '1.5e+1',
    '10.',
    '9007199254740991',
    '-9007199254740991',
    '1e-200',
  ])('parses %s', (value) => {
    expect(parseFiniteNumber(value)).toBe(Number(value));
  });

  it.each([
    undefined,
    null,
    4,
    true,
    {},
    [],
    '',
    ' ',
    ' 1',
    '1 ',
    '1 2',
    'abc',
    '0x10',
    '0X10',
    '+0x1',
    '0b10',
    '0o10',
    'NaN',
    'Infinity',
    '-Infinity',
    '1e400',
    '1e309',
  ])('rejects %s', (value) => {
    expect(parseFiniteNumber(value)).toBeUndefined();
  });

  it.each(['9007199254740993', '-9007199254740993', '9007199254740992', '9007199254740991.2'])(
    'rejects %s as outside the safe integer range',
    (value) => {
      expect(parseFiniteNumber(value)).toEqual(new OperandRejection('range'));
    },
  );

  it.each(['1e-400', '-1e-400', '1e-324'])('rejects %s because it underflows to zero', (value) => {
    expect(parseFiniteNumber(value)).toEqual(new OperandRejection('underflow'));
  });

  it.each(['0.30000000000000001', '9007199254740990.9'])(
    'rejects %s because it is not an exact double',
    (value) => {
      expect(parseFiniteNumber(value)).toEqual(new OperandRejection('precision'));
    },
  );
});
