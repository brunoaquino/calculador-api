import { ApiProperty } from '@nestjs/swagger';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  traceId: string;
  path: string;
  timestamp: string;
}

export class ErrorResponseDto implements ErrorResponseBody {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'Bad Request' })
  error!: string;

  @ApiProperty({
    oneOf: [
      { type: 'string', example: 'Division by zero is not allowed' },
      {
        type: 'array',
        items: { type: 'string' },
        example: ['term_one must be a finite decimal number'],
      },
    ],
  })
  message!: string | string[];

  @ApiProperty({ example: '4bf92f3577b34da6a3ce929d0e0e4736' })
  traceId!: string;

  @ApiProperty({ example: '/api/div' })
  path!: string;

  @ApiProperty({ example: '2026-11-06T12:00:00.000Z' })
  timestamp!: string;
}
