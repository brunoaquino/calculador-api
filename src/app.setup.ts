import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { RequestHandler } from 'express';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { getAppConfig } from './config/app-config';

interface ExpressServer {
  disable(setting: string): void;
  use(handler: RequestHandler): void;
}

export function configureApp(app: INestApplication): void {
  const config = getAppConfig(app.get(ConfigService));
  const server = app.getHttpAdapter().getInstance() as ExpressServer;
  server.disable('x-powered-by');
  server.use(
    config.swaggerEnabled
      ? helmet({
          contentSecurityPolicy: false,
          crossOriginEmbedderPolicy: false,
        })
      : helmet(),
  );

  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Calculador API')
        .setDescription(
          'Arithmetic operations over HTTP. Invalid operands, division by zero and non-finite results respond with HTTP 400. Unexpected failures respond with HTTP 500 and a generic message.',
        )
        .setVersion(config.version)
        .addTag('calculator', 'Basic arithmetic')
        .addTag('health', 'Liveness and readiness probes')
        .build(),
    );
    SwaggerModule.setup('docs', app, document, {
      useGlobalPrefix: false,
      jsonDocumentUrl: 'docs-json',
      customSiteTitle: 'Calculador API',
      raw: ['json'],
    });
  }
}
