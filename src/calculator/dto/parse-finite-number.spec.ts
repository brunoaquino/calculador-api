import { parseFiniteNumber } from './parse-finite-number';

describe('parseFiniteNumber', () => {
  it.each(['0', '-0', '4', '-3', '2.5', '+2.5', '1e2', '1e-1', '1.5e+1', '10.'])(
    'parses %s',
    (value) => {
      expect(parseFiniteNumber(value)).toBe(Number(value));
    },
  );

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
});
