import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ErrorResponseBody } from '../dto/error-response.dto';
import { GlobalExceptionFilter } from './global-exception.filter';

interface ResponseDouble {
  setHeader: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
}

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('formats an HttpException string response', () => {
    const { response, body } = capture(
      filter,
      new BadRequestException('Division by zero is not allowed'),
      { id: 'trace-1', path: '/api/div' },
    );

    expect(body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Division by zero is not allowed',
      traceId: 'trace-1',
      path: '/api/div',
    });
    expect(body.timestamp).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(response.setHeader).toHaveBeenCalledWith('x-trace-id', 'trace-1');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('keeps string and string-array messages from exception bodies', () => {
    expect(
      capture(filter, new BadRequestException({ message: 'term_one is required' }), {
        path: '/api/sum',
      }).body.message,
    ).toBe('term_one is required');
    expect(
      capture(
        filter,
        new BadRequestException({ message: ['term_one is required', 'term_two is required'] }),
        {
          path: '/api/sum',
        },
      ).body.message,
    ).toEqual(['term_one is required', 'term_two is required']);
  });

  it('falls back when the exception body has no usable message', () => {
    const numeric = new HttpException({ message: 5 }, 400);
    expect(capture(filter, numeric, { path: '/api/sum' }).body.message).toBe(numeric.message);

    const mixed = new BadRequestException('placeholder');
    jest.spyOn(mixed, 'getResponse').mockReturnValue({ message: ['ok', 1] });
    expect(capture(filter, mixed, { path: '/api/sum' }).body.message).toBe(mixed.message);

    const withoutMessage = new HttpException({ error: 'Bad Request' }, 400);
    expect(capture(filter, withoutMessage, { path: '/api/sum' }).body.message).toBe(
      withoutMessage.message,
    );

    const arrayBody = new BadRequestException('placeholder');
    jest.spyOn(arrayBody, 'getResponse').mockReturnValue(['nope']);
    expect(capture(filter, arrayBody, { path: '/api/sum' }).body.message).toBe(arrayBody.message);

    const nullBody = new BadRequestException('placeholder');
    jest.spyOn(nullBody, 'getResponse').mockReturnValue(null as never);
    expect(capture(filter, nullBody, { path: '/api/sum' }).body.message).toBe(nullBody.message);
  });

  it('names known and unknown status codes', () => {
    expect(
      capture(filter, new NotFoundException('Cannot GET /missing'), { path: '/missing' }).body,
    ).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      path: '/missing',
    });
    expect(capture(filter, new HttpException('nope', 999), { path: '/x' }).body.error).toBe(
      'Error',
    );
  });

  it('hides unknown failures behind a generic 500 and logs the stack', () => {
    const failure = new Error('disk failed');
    const { body } = capture(filter, failure, { id: 'trace-500', path: '/api/sum' });

    expect(body).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
      traceId: 'trace-500',
      path: '/api/sum',
    });
    expect(JSON.stringify(body)).not.toContain('disk failed');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unhandled exception'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('disk failed'));
  });

  it('logs errors that are not Error instances', () => {
    capture(filter, 'fail', { path: '/api/sum' });
    expect(errorSpy).toHaveBeenCalledWith('Unhandled exception: fail');

    errorSpy.mockClear();
    capture(filter, { boom: true }, { path: '/api/sum' });
    expect(errorSpy).toHaveBeenCalledWith('Unhandled exception: Non-error exception');
  });

  it('logs an error whose stack was stripped', () => {
    const failure = new Error('disk failed');
    failure.stack = undefined;
    capture(filter, failure, { path: '/api/sum' });
    expect(errorSpy).toHaveBeenCalledWith('Unhandled exception: disk failed');
  });

  it('generates a trace id when the request does not have a usable one', () => {
    expect(capture(filter, new NotFoundException('missing'), {}).body.traceId).toMatch(
      /^[a-f0-9]{32}$/,
    );
    expect(capture(filter, new NotFoundException('missing'), { id: '' }).body.traceId).toMatch(
      /^[a-f0-9]{32}$/,
    );
    expect(capture(filter, new NotFoundException('missing'), { id: 15 }).body.traceId).toMatch(
      /^[a-f0-9]{32}$/,
    );
  });

  it('derives the path from the URL when Express path is absent', () => {
    expect(
      capture(filter, new NotFoundException('missing'), {
        path: '',
        originalUrl: '/api/div?term_two=0',
      }).body.path,
    ).toBe('/api/div');
    expect(
      capture(filter, new NotFoundException('missing'), { url: '/health/live?x=1' }).body.path,
    ).toBe('/health/live');
    expect(capture(filter, new NotFoundException('missing'), { originalUrl: '' }).body.path).toBe(
      '/',
    );
    expect(
      capture(filter, new NotFoundException('missing'), { originalUrl: '?x=1' }).body.path,
    ).toBe('/');
    expect(capture(filter, new NotFoundException('missing'), {}).body.path).toBe('/');
  });
});

function capture(
  filter: GlobalExceptionFilter,
  exception: unknown,
  request: { id?: unknown; path?: string; url?: string; originalUrl?: string },
): { response: ResponseDouble; body: ErrorResponseBody } {
  const response: ResponseDouble = {
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  filter.catch(exception, httpHost(request, response));
  const body = response.json.mock.calls[0]?.[0] as ErrorResponseBody;
  return { response, body };
}

function httpHost(
  request: { id?: unknown; path?: string; url?: string; originalUrl?: string },
  response: ResponseDouble,
): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
    getArgs: () => [],
    getArgByIndex: () => undefined,
    getType: () => 'http',
    switchToRpc: () => {
      throw new Error('RPC host is not used');
    },
    switchToWs: () => {
      throw new Error('WS host is not used');
    },
  } as ArgumentsHost;
}
