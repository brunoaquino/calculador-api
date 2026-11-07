import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { bootstrap } from './bootstrap';

jest.mock('./app.setup', () => ({
  configureApp: jest.fn(),
}));

describe('bootstrap', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('configures the application and listens on 0.0.0.0', async () => {
    const logger = { log: jest.fn() };
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'port') {
          return 8123;
        }
        throw new Error(`Unexpected config key ${key}`);
      }),
    };
    const app = {
      useLogger: jest.fn(),
      get: jest.fn((token: unknown) => {
        if (token === PinoNestLogger) {
          return logger;
        }
        if (token === ConfigService) {
          return config;
        }
        throw new Error(`Unexpected token ${String(token)}`);
      }),
      listen: jest.fn().mockResolvedValue(undefined),
      enableShutdownHooks: jest.fn(),
    };
    jest.spyOn(NestFactory, 'create').mockResolvedValue(app as never);

    await bootstrap();

    expect(NestFactory.create).toHaveBeenCalledWith(
      expect.objectContaining({ module: AppModule }),
      { bufferLogs: true },
    );
    expect(app.useLogger).toHaveBeenCalledWith(logger);
    expect(configureApp).toHaveBeenCalledWith(app);
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalledWith(8123, '0.0.0.0');
    expect(logger.log).toHaveBeenCalledWith('Application listening on 0.0.0.0:8123', 'Bootstrap');
  });
});
