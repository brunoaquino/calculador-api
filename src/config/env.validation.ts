import {
  DEFAULT_HEALTH_HEAP_THRESHOLD_MB,
  LOG_LEVELS,
  MAX_HEALTH_HEAP_THRESHOLD_MB,
  NODE_ENVS,
  type AppConfig,
} from './app-config';
import { readAppVersion } from '../version';

const DEFAULT_PORT = 8000;
const DEFAULT_SERVICE_NAME = 'calculador-api';

export function isTestEnvironment(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv === 'test';
}

export function validateEnvironment(raw: Record<string, unknown>): AppConfig {
  const errors: string[] = [];
  const port = readPort(raw.PORT, errors);
  const nodeEnv = readChoice(raw.NODE_ENV, NODE_ENVS, 'development', 'NODE_ENV', errors);
  const logLevel = readChoice(raw.LOG_LEVEL, LOG_LEVELS, 'info', 'LOG_LEVEL', errors);
  const swaggerEnabled = readBoolean(raw.SWAGGER_ENABLED, true, 'SWAGGER_ENABLED', errors);
  const serviceName = readServiceName(raw.SERVICE_NAME, errors);
  const healthHeapThresholdMb = readHeapThresholdMb(raw.HEALTH_HEAP_THRESHOLD_MB, errors);

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n- ${errors.join('\n- ')}`);
  }

  return {
    port,
    nodeEnv,
    logLevel,
    swaggerEnabled,
    serviceName,
    version: readAppVersion(),
    healthHeapThresholdMb,
  };
}

function readPort(value: unknown, errors: string[]): number {
  if (value === undefined || value === '') {
    return DEFAULT_PORT;
  }

  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535) {
    return value;
  }

  if (typeof value === 'string' && /^[1-9]\d{0,4}$/.test(value)) {
    const port = Number(value);
    if (port >= 1 && port <= 65535) {
      return port;
    }
  }

  errors.push('PORT must be an integer between 1 and 65535');
  return DEFAULT_PORT;
}

function readChoice<T extends string>(
  value: unknown,
  allowed: readonly T[],
  defaultValue: T,
  name: string,
  errors: string[],
): T {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  if (typeof value === 'string' && isAllowed(value, allowed)) {
    return value;
  }

  errors.push(`${name} must be one of: ${allowed.join(', ')}`);
  return defaultValue;
}

function isAllowed<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.some((item) => item === value);
}

function readBoolean(
  value: unknown,
  defaultValue: boolean,
  name: string,
  errors: string[],
): boolean {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  if (value === true) {
    return true;
  }

  if (value === false) {
    return false;
  }

  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  errors.push(`${name} must be true or false`);
  return defaultValue;
}

function readHeapThresholdMb(value: unknown, errors: string[]): number {
  if (value === undefined || value === '') {
    return DEFAULT_HEALTH_HEAP_THRESHOLD_MB;
  }

  if (isHeapThreshold(value)) {
    return value;
  }

  if (typeof value === 'string' && /^[1-9]\d{0,4}$/.test(value)) {
    const threshold = Number(value);
    if (isHeapThreshold(threshold)) {
      return threshold;
    }
  }

  errors.push(
    `HEALTH_HEAP_THRESHOLD_MB must be an integer between 1 and ${MAX_HEALTH_HEAP_THRESHOLD_MB}`,
  );
  return DEFAULT_HEALTH_HEAP_THRESHOLD_MB;
}

function isHeapThreshold(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_HEALTH_HEAP_THRESHOLD_MB
  );
}

function readServiceName(value: unknown, errors: string[]): string {
  if (value === undefined || value === '') {
    return DEFAULT_SERVICE_NAME;
  }

  if (typeof value === 'string' && value.trim().length > 0 && value === value.trim()) {
    return value;
  }

  errors.push('SERVICE_NAME must be a non-empty string');
  return DEFAULT_SERVICE_NAME;
}
