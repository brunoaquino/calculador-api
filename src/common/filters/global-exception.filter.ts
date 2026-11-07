import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErrorResponseBody } from '../dto/error-response.dto';
import { isRecord } from '../is-record';
import { generateTraceId } from '../logging/trace-id';

interface HttpRequest {
  id?: unknown;
  path?: string;
  url?: string;
  originalUrl?: string;
}

interface HttpResponse {
  setHeader(name: string, value: string): void;
  status(code: number): HttpResponse;
  json(body: ErrorResponseBody): void;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

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
      this.logger.error(`Unhandled exception: ${describeException(exception)}`);
    }

    response.setHeader('x-trace-id', body.traceId);
    response.status(statusCode).json(body);
  }
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

function describeException(exception: unknown): string {
  if (exception instanceof Error) {
    return exception.stack ?? exception.message;
  }

  if (typeof exception === 'string') {
    return exception;
  }

  return 'Non-error exception';
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
