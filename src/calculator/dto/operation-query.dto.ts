import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Validate } from 'class-validator';
import { SAFE_INTEGER_LIMIT } from '../exact-decimal';
import { FiniteDecimalConstraint } from './finite-decimal.constraint';
import { parseFiniteNumber } from './parse-finite-number';

export const OPERAND_DESCRIPTION =
  'Finite number in decimal or scientific notation, for example -3, 2.5 or 1e2. ' +
  `Absolute value must be at most ${SAFE_INTEGER_LIMIT}, and the text must be exactly representable as an IEEE-754 double in its shortest form. ` +
  'Blank values, whitespace, non-numeric text, hexadecimal (0x10), binary, octal, NaN, Infinity, overflow (1e400), underflow to zero (1e-400) and extra significant digits (0.30000000000000001) are rejected.';

export class OperationQueryDto {
  @ApiProperty({ type: String, example: '4', description: OPERAND_DESCRIPTION })
  @Transform(({ value }: { value: unknown }) => parseFiniteNumber(value) ?? value)
  @Validate(FiniteDecimalConstraint)
  term_one!: number;

  @ApiProperty({ type: String, example: '1', description: OPERAND_DESCRIPTION })
  @Transform(({ value }: { value: unknown }) => parseFiniteNumber(value) ?? value)
  @Validate(FiniteDecimalConstraint)
  term_two!: number;
}
