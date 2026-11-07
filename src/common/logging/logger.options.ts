import { createRequire } from 'node:module';
import type { Params } from 'nestjs-pino';
import pino, { type DestinationStream, type Logger as PinoLoggerInstance } from 'pino';
import type { Options } from 'pino-http';
import type { AppConfig } from '../../config/app-config';
import { resolveTraceId } from './trace-id';

const nodeRequire = createRequire(`${process.cwd()}/package.json`);

let logDestination: DestinationStream | undefined;

/** Installed by tests that need a deterministic JSON log stream. Production leaves this unset. */
export function setLogDestination(destination: DestinationStream | undefined): void {
  logDestination = destination;
}

export interface SerializedRequest {
  method?: string;
  url?: string;
  remoteAddress?: string;
  userAgent?: string;
}

export interface SerializedResponse {
  statusCode?: number;
}

interface RequestLogInput {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null };
  remoteAddress?: string | null;
}

interface ResponseLogInput {
  statusCode?: number;
  setHeader?: (name: string, value: string) => void;
}

export function isPackageAvailable(packageName: string): boolean {
  try {
    nodeRequire.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

export function shouldIgnoreAccessLog(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  const path = url.split('?')[0];
  return (
    path.startsWith('/health/') ||
    path === '/health' ||
    path.startsWith('/docs') ||
    path === '/metrics'
  );
}

export function resolveAccessLogLevel(
  statusCode: number,
  error?: Error,
): 'info' | 'warn' | 'error' {
  if (error !== undefined || statusCode >= 500) {
    return 'error';
  }

  if (statusCode >= 400) {
    return 'warn';
  }

  return 'info';
}

export function serializeRequest(request: RequestLogInput): SerializedRequest {
  const header = request.headers?.['user-agent'];
  const userAgent = Array.isArray(header) ? header[0] : header;
  const directAddress = request.remoteAddress;
  const socketAddress = request.socket?.remoteAddress;
  const remoteAddress =
    typeof directAddress === 'string' && directAddress.length > 0
      ? directAddress
      : typeof socketAddress === 'string' && socketAddress.length > 0
        ? socketAddress
        : undefined;

  return {
    method: request.method,
    url: request.url,
    remoteAddress,
    userAgent,
  };
}

export function serializeResponse(response: ResponseLogInput): SerializedResponse {
  return { statusCode: response.statusCode };
}

export function createLoggerModuleParams(config: AppConfig): Params {
  const options = createPinoHttpOptions(config);
  if (logDestination) {
    return { pinoHttp: [options, logDestination] };
  }

  return { pinoHttp: options };
}

export function createPinoHttpOptions(
  config: AppConfig,
  prettyAvailable: boolean = isPackageAvailable('pino-pretty'),
): Options {
  const options: Options = {
    level: config.logLevel,
    quietReqLogger: true,
    customAttributeKeys: {
      reqId: 'traceId',
    },
    wrapSerializers: false,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      censor: '[Redacted]',
    },
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    mixin: (_mergeObject: object, _level: number, logger: PinoLoggerInstance) =>
      buildStandardFields(config, logger),
    genReqId: (request, response) => {
      const traceId = resolveTraceId(request.headers);
      response.setHeader('x-trace-id', traceId);
      return traceId;
    },
    customLogLevel: (_request, response, error) =>
      resolveAccessLogLevel(response.statusCode, error),
    autoLogging: {
      ignore: (request) => shouldIgnoreAccessLog(request.url),
    },
    serializers: {
      err: pino.stdSerializers.err,
      req: (request: RequestLogInput) => serializeRequest(request),
      res: (response: ResponseLogInput) => serializeResponse(response),
    },
  };

  if (config.nodeEnv === 'development' && prettyAvailable) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: true,
        translateTime: 'SYS:standard',
      },
    };
  }

  return options;
}

function buildStandardFields(
  config: AppConfig,
  logger: PinoLoggerInstance,
): Record<string, string> {
  const fields: Record<string, string> = {
    service: config.serviceName,
    version: config.version,
    env: config.nodeEnv,
  };
  const traceId: unknown = logger.bindings().traceId;
  if (typeof traceId === 'string' && traceId.length > 0) {
    return fields;
  }

  return {
    ...fields,
    traceId: 'system',
  };
}
