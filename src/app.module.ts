import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { CalculatorModule } from './calculator/calculator.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { createLoggerModuleParams } from './common/logging/logger.options';
import { getAppConfig } from './config/app-config';
import { isTestEnvironment, validateEnvironment } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({})
export class AppModule {
  static register(): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: false,
          ignoreEnvFile: isTestEnvironment(),
          validate: validateEnvironment,
        }),
        LoggerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (configService: ConfigService) =>
            createLoggerModuleParams(getAppConfig(configService)),
        }),
        MetricsModule,
        CalculatorModule,
        HealthModule,
      ],
      providers: [
        {
          provide: APP_FILTER,
          useClass: GlobalExceptionFilter,
        },
      ],
    };
  }
}
