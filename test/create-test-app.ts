import {
  type DynamicModule,
  type ForwardReference,
  INestApplication,
  type Type,
} from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

type ImportedModule = Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference;

export async function createTestApp(
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
  extraImports: ImportedModule[] = [],
): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule.register(), ...extraImports],
  });
  if (customize) {
    builder = customize(builder);
  }

  const moduleFixture = await builder.compile();
  const app = moduleFixture.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  await app.init();
  return app;
}
