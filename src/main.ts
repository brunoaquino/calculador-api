import 'reflect-metadata';
import { bootstrap } from './bootstrap';

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : 'Application failed to start';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
