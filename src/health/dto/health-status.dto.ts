import { ApiProperty } from '@nestjs/swagger';

export class HealthStatusDto {
  @ApiProperty({ example: 'ok' })
  status!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  info!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  error!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  details!: Record<string, unknown>;
}
