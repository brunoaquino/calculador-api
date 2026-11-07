import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { CalculatorModule } from './calculator/calculator.module';
import { createLoggerModuleParams } from './common/logging/logger.options';
import { getAppConfig } from './config/app-config';
import { isTestEnvironment, validateEnvironment } from './config/env.validation';
import { HealthModule } from './health/health.module';

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
        CalculatorModule,
        HealthModule,
      ],
    };
  }
}
