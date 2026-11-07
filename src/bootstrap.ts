import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule.register(), { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  configureApp(app);
  app.enableShutdownHooks();
  const port = app.get(ConfigService).getOrThrow<number>('port');
  await app.listen(port, '0.0.0.0');
  logger.log(`Application listening on 0.0.0.0:${port}`, 'Bootstrap');
}
