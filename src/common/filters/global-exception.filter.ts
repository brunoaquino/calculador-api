import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ErrorResponseBody } from '../dto/error-response.dto';
import { isRecord } from '../is-record';
import { generateTraceId } from '../logging/trace-id';

interface HttpRequest {
  id?: unknown;
  path?: string;
  url?: string;
  originalUrl?: string;
  log?: unknown;
}

interface HttpResponse {
  setHeader(name: string, value: string): void;
  status(code: number): HttpResponse;
  json(body: ErrorResponseBody): void;
}

interface BoundLogger {
  error(payload: { err: unknown; context: string }, message: string): void;
}

const UNHANDLED_MESSAGE = 'Unhandled exception';

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(GlobalExceptionFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();
    const statusCode = resolveStatus(exception);
    const body: ErrorResponseBody = {
      statusCode,
      error: httpErrorName(statusCode),
      message: resolveMessage(exception),
      traceId: resolveRequestTraceId(request),
      path: resolveRequestPath(request),
      timestamp: new Date().toISOString(),
    };

    if (!(exception instanceof HttpException)) {
      this.logUnhandled(request, exception);
    }

    response.setHeader('x-trace-id', body.traceId);
    response.status(statusCode).json(body);
  }

  private logUnhandled(request: HttpRequest, exception: unknown): void {
    const payload = { err: exception, context: GlobalExceptionFilter.name };
    const requestLogger = request.log;
    if (isBoundLogger(requestLogger)) {
      requestLogger.error(payload, UNHANDLED_MESSAGE);
      return;
    }

    this.logger.error(payload, UNHANDLED_MESSAGE);
  }
}

function isBoundLogger(value: unknown): value is BoundLogger {
  return isRecord(value) && typeof value.error === 'function';
}

function resolveStatus(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
}

function resolveMessage(exception: unknown): string | string[] {
  if (!(exception instanceof HttpException)) {
    return 'Internal server error';
  }

  const responseBody: unknown = exception.getResponse();
  if (typeof responseBody === 'string') {
    return responseBody;
  }

  if (isRecord(responseBody) && 'message' in responseBody) {
    const message: unknown = responseBody.message;
    if (typeof message === 'string' || isStringArray(message)) {
      return message;
    }
  }

  return exception.message;
}

function resolveRequestTraceId(request: HttpRequest): string {
  if (typeof request.id === 'string' && request.id.length > 0) {
    return request.id;
  }

  return generateTraceId();
}

function resolveRequestPath(request: HttpRequest): string {
  if (typeof request.path === 'string' && request.path.length > 0) {
    return request.path;
  }

  const rawUrl = request.originalUrl ?? request.url;
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return '/';
  }

  const path = rawUrl.split('?')[0];
  if (!path) {
    return '/';
  }

  return path;
}

function httpErrorName(statusCode: number): string {
  const label = HttpStatus[statusCode];
  if (typeof label !== 'string') {
    return 'Error';
  }

  return label
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
