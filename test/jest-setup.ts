import 'reflect-metadata';

process.env.NODE_ENV = 'test';
process.env.PORT = '8000';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'true';
process.env.SERVICE_NAME = 'calculador-api';
// The Jest process can pass the production 144 MiB heap budget. Tests raise the
// ceiling; the container and the ConfigMap keep HEALTH_HEAP_THRESHOLD_MB=144.
process.env.HEALTH_HEAP_THRESHOLD_MB = '4096';
