import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { RequestHandler } from 'express';
import helmet from 'helmet';
import { SAFE_INTEGER_LIMIT } from './calculator/exact-decimal';
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

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Calculador API')
        .setDescription(
          'Arithmetic operations over HTTP. Operands must be exactly representable IEEE-754 doubles within ' +
            `±${SAFE_INTEGER_LIMIT}. Invalid operands, division by zero, results outside that safe range and results too small to represent exactly respond with HTTP 400. ` +
            'Non-integer results are rounded to 15 significant digits. Unexpected failures respond with HTTP 500 and a generic message.',
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
