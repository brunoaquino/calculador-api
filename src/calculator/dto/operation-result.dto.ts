import { ApiProperty } from '@nestjs/swagger';

export class OperationResultDto {
  @ApiProperty({
    example: 3,
    description: 'Arithmetic result. Non-integers are returned as JSON numbers, for example 2.5.',
  })
  result!: number;
}
