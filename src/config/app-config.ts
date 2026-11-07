import { ConfigService } from '@nestjs/config';

export const NODE_ENVS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Default stays under the 256Mi container memory limit. */
export const DEFAULT_HEALTH_HEAP_THRESHOLD_MB = 200;
export const MAX_HEALTH_HEAP_THRESHOLD_MB = 8192;

export interface AppConfig {
  port: number;
  nodeEnv: NodeEnv;
  logLevel: LogLevel;
  swaggerEnabled: boolean;
  serviceName: string;
  version: string;
  healthHeapThresholdMb: number;
}

export function getAppConfig(configService: ConfigService): AppConfig {
  return {
    port: configService.getOrThrow<number>('port'),
    nodeEnv: configService.getOrThrow<NodeEnv>('nodeEnv'),
    logLevel: configService.getOrThrow<LogLevel>('logLevel'),
    swaggerEnabled: configService.getOrThrow<boolean>('swaggerEnabled'),
    serviceName: configService.getOrThrow<string>('serviceName'),
    version: configService.getOrThrow<string>('version'),
    healthHeapThresholdMb: configService.getOrThrow<number>('healthHeapThresholdMb'),
  };
}
