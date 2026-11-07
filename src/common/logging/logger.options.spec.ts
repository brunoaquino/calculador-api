import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from '../../config/app-config';
import {
  createLoggerModuleParams,
  createPinoHttpOptions,
  isPackageAvailable,
  resolveAccessLogLevel,
  serializeRequest,
  serializeResponse,
  setLogDestination,
  shouldIgnoreAccessLog,
} from './logger.options';

const config: AppConfig = {
  port: 8000,
  nodeEnv: 'test',
  logLevel: 'info',
  swaggerEnabled: true,
  serviceName: 'calculador-api',
  version: '1.0.0',
  healthHeapThresholdMb: 200,
};

describe('isPackageAvailable', () => {
  it('detects installed and missing packages', () => {
    expect(isPackageAvailable('pino-pretty')).toBe(true);
    expect(isPackageAvailable('package-that-does-not-exist-xyz')).toBe(false);
  });
});

describe('shouldIgnoreAccessLog', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['/api/sum?term_one=1', false],
    ['/health', true],
    ['/health/live?ready=1', true],
    ['/docs', true],
    ['/docs-json', true],
    ['/docs/swagger-ui.css', true],
  ])('classifies %s as ignored=%s', (url, ignored) => {
    expect(shouldIgnoreAccessLog(url)).toBe(ignored);
  });
});

describe('resolveAccessLogLevel', () => {
  it('maps status codes and thrown errors', () => {
    expect(resolveAccessLogLevel(200)).toBe('info');
    expect(resolveAccessLogLevel(399)).toBe('info');
    expect(resolveAccessLogLevel(400)).toBe('warn');
    expect(resolveAccessLogLevel(499)).toBe('warn');
    expect(resolveAccessLogLevel(500)).toBe('error');
    expect(resolveAccessLogLevel(200, new Error('boom'))).toBe('error');
  });
});

describe('serializers', () => {
  it('keeps a compact request and drops credential headers', () => {
    expect(
      serializeRequest({
        method: 'GET',
        url: '/api/sum?term_one=1&term_two=2',
        headers: {
          'user-agent': ['curl/8.0', 'ignored'],
          authorization: 'Bearer secret-token',
          cookie: 'sid=secret-cookie',
        },
        remoteAddress: '10.0.0.8',
        socket: { remoteAddress: '127.0.0.1' },
      }),
    ).toEqual({
      method: 'GET',
      url: '/api/sum?term_one=1&term_two=2',
      remoteAddress: '10.0.0.8',
      userAgent: 'curl/8.0',
    });
  });

  it('reads the socket address and a single user agent', () => {
    expect(
      serializeRequest({
        method: 'GET',
        url: '/api/sub',
        headers: { 'user-agent': 'jest' },
        socket: { remoteAddress: '127.0.0.1' },
      }),
    ).toEqual({
      method: 'GET',
      url: '/api/sub',
      remoteAddress: '127.0.0.1',
      userAgent: 'jest',
    });
  });

  it('omits an empty or missing address', () => {
    expect(serializeRequest({ method: 'GET', url: '/api/sub', remoteAddress: '' })).toEqual({
      method: 'GET',
      url: '/api/sub',
      remoteAddress: undefined,
      userAgent: undefined,
    });
    expect(serializeRequest({ socket: { remoteAddress: null } }).remoteAddress).toBeUndefined();
  });

  it('copies the response status code', () => {
    expect(serializeResponse({ statusCode: 201 })).toEqual({ statusCode: 201 });
    expect(serializeResponse({})).toEqual({ statusCode: undefined });
  });
});

describe('createLoggerModuleParams', () => {
  it('uses stdout unless a test destination is installed', () => {
    expect(Array.isArray(createLoggerModuleParams(config).pinoHttp)).toBe(false);

    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    setLogDestination(stream);
    try {
      expect(createLoggerModuleParams(config).pinoHttp).toEqual([expect.any(Object), stream]);
    } finally {
      setLogDestination(undefined);
    }

    expect(Array.isArray(createLoggerModuleParams(config).pinoHttp)).toBe(false);
  });
});

describe('createPinoHttpOptions', () => {
  it('enables pretty transport only for development when pino-pretty exists', () => {
    expect(createPinoHttpOptions({ ...config, nodeEnv: 'development' }, true).transport).toEqual({
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: true,
        translateTime: 'SYS:standard',
      },
    });
    expect(
      createPinoHttpOptions({ ...config, nodeEnv: 'development' }, false).transport,
    ).toBeUndefined();
    expect(
      createPinoHttpOptions({ ...config, nodeEnv: 'production' }, true).transport,
    ).toBeUndefined();
    expect(createPinoHttpOptions(config).transport).toBeUndefined();
  });

  it('adds standard fields and avoids a duplicate traceId', () => {
    const options = createPinoHttpOptions(config, false);
    const mixin = options.mixin;
    if (typeof mixin !== 'function') {
      throw new Error('expected mixin');
    }

    const root = pino({ level: 'silent' });
    expect(mixin({}, 30, root)).toEqual({
      service: 'calculador-api',
      version: '1.0.0',
      env: 'test',
      traceId: 'system',
    });
    expect(mixin({}, 30, root.child({ traceId: 'abc' }))).toEqual({
      service: 'calculador-api',
      version: '1.0.0',
      env: 'test',
    });
    expect(mixin({}, 30, root.child({ traceId: '' }))).toMatchObject({ traceId: 'system' });
    expect(mixin({}, 30, root.child({ traceId: 12 }))).toMatchObject({ traceId: 'system' });
  });

  it('writes one compact JSON line per request and echoes the trace id', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const middleware = pinoHttp(createPinoHttpOptions(config, false), stream);
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';

    const success = fakeResponse();
    middleware(
      asRequest(
        fakeRequest('/api/sub?term_one=4&term_two=1', {
          traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
          authorization: 'Bearer secret-token',
          cookie: 'sid=secret-cookie',
        }),
      ),
      asResponse(success.response),
      () => {
        success.response.statusCode = 200;
        success.response.emit('finish');
      },
    );

    const missing = fakeResponse();
    middleware(
      asRequest(fakeRequest('/api/div?term_one=1&term_two=0')),
      asResponse(missing.response),
      () => {
        missing.response.statusCode = 400;
        missing.response.emit('finish');
      },
    );

    const failure = fakeResponse();
    middleware(asRequest(fakeRequest('/api/sum')), asResponse(failure.response), () => {
      failure.response.statusCode = 500;
      failure.response.emit('finish');
    });

    const probe = fakeResponse();
    middleware(asRequest(fakeRequest('/health/live')), asResponse(probe.response), () => {
      probe.response.emit('finish');
    });
    const docs = fakeResponse();
    middleware(asRequest(fakeRequest('/docs')), asResponse(docs.response), () => undefined);

    middleware.logger
      .child({ traceId })
      .info({ context: 'CalculatorService', operation: 'sub' }, 'Calculation completed');

    const parsed = lines.flatMap((chunk) =>
      chunk
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => ({ raw: line, json: JSON.parse(line) as Record<string, unknown> })),
    );

    expect(parsed).toHaveLength(4);
    expect(parsed.every((line) => line.raw.split('"traceId"').length - 1 === 1)).toBe(true);
    const rawLogs = parsed.map((line) => line.raw).join('');
    expect(rawLogs).not.toContain('secret-token');
    expect(rawLogs).not.toContain('secret-cookie');

    const access = parsed[0]?.json;
    expect(access).toMatchObject({
      level: 'info',
      service: 'calculador-api',
      version: '1.0.0',
      env: 'test',
      traceId,
      msg: 'request completed',
      req: {
        method: 'GET',
        url: '/api/sub?term_one=4&term_two=1',
        remoteAddress: '127.0.0.1',
        userAgent: 'jest-agent',
      },
      res: { statusCode: 200 },
    });
    expect(access?.time).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(typeof access?.responseTime).toBe('number');
    expect(success.headers['x-trace-id']).toBe(traceId);
    expect(parsed[1]?.json.level).toBe('warn');
    expect(parsed[2]?.json.level).toBe('error');
    expect(parsed[3]?.json).toMatchObject({
      level: 'info',
      traceId,
      context: 'CalculatorService',
      msg: 'Calculation completed',
    });
    expect(missing.headers['x-trace-id']).toMatch(/^[a-f0-9]{32}$/);
  });

  it('serializes err with type, message and stack', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer | string, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const middleware = pinoHttp(createPinoHttpOptions(config, false), stream);
    const failure = new Error('disk failed');
    middleware.logger.error(
      { err: failure, context: 'GlobalExceptionFilter' },
      'Unhandled exception',
    );

    const record = JSON.parse(lines.join('')) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'error',
      context: 'GlobalExceptionFilter',
      msg: 'Unhandled exception',
    });
    expect(record.err).toMatchObject({
      type: 'Error',
      message: 'disk failed',
    });
    expect((record.err as { stack: string }).stack).toContain('disk failed');
  });
});

function asRequest(request: ReturnType<typeof fakeRequest>): IncomingMessage {
  return request as unknown as IncomingMessage;
}

function asResponse(response: ReturnType<typeof fakeResponse>['response']): ServerResponse {
  return response as unknown as ServerResponse;
}

function fakeRequest(
  url: string,
  headers: Record<string, string> = {},
): {
  method: string;
  url: string;
  headers: Record<string, string>;
  socket: { remoteAddress: string };
  readableAborted: boolean;
} {
  return {
    method: 'GET',
    url,
    headers: { 'user-agent': 'jest-agent', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    readableAborted: false,
  };
}

function fakeResponse(): {
  response: EventEmitter & {
    statusCode: number;
    writableEnded: boolean;
    setHeader: (name: string, value: string) => void;
  };
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const response = new EventEmitter() as EventEmitter & {
    statusCode: number;
    writableEnded: boolean;
    setHeader: (name: string, value: string) => void;
  };
  response.statusCode = 200;
  response.writableEnded = true;
  response.setHeader = (name: string, value: string) => {
    headers[name.toLowerCase()] = value;
  };
  return { response, headers };
}
