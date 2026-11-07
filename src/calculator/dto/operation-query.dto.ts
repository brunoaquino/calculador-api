import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Validate } from 'class-validator';
import { FiniteDecimalConstraint } from './finite-decimal.constraint';
import { parseFiniteNumber } from './parse-finite-number';

export const OPERAND_DESCRIPTION =
  'Finite number in decimal or scientific notation, for example -3, 2.5 or 1e2. ' +
  'Blank values, whitespace, non-numeric text, hexadecimal (0x10), binary, octal, NaN, Infinity and values that overflow to Infinity (1e400) are rejected.';

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
