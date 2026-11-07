import { ApiProperty } from '@nestjs/swagger';

export class OperationResultDto {
  @ApiProperty({
    example: 3,
    description:
      'Arithmetic result as a JSON number. Integers stay exact within the safe range. Other values are rounded to 15 significant digits, for example 0.3 or 2.5.',
  })
  result!: number;
}
