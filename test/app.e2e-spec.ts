import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import request from 'supertest';
import { CalculatorService } from '../src/calculator/calculator.service';
import { createTestApp } from './create-test-app';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const TRACEPARENT = `00-${TRACE_ID}-00f067aa0ba902b7-01`;

describe('Calculador API', () => {
  let app: INestApplication;
  let http: request.Agent;

  beforeAll(async () => {
    process.env.SWAGGER_ENABLED = 'true';
    app = await createTestApp();
    http = request(app.getHttpServer() as Server);
  });

  afterAll(async () => {
    await app.close();
  });

  it('adds, subtracts, multiplies and divides', async () => {
    await http
      .get('/api/sum')
      .query({ term_one: '-3', term_two: '2.5' })
      .expect(200)
      .expect({ result: -0.5 });
    await http
      .get('/api/sub')
      .query({ term_one: '4', term_two: '1' })
      .expect(200)
      .expect({ result: 3 });
    await http
      .get('/api/mul')
      .query({ term_one: '3', term_two: '5' })
      .expect(200)
      .expect({ result: 15 });
    await http
      .get('/api/div')
      .query({ term_one: '5', term_two: '2' })
      .expect(200)
      .expect({ result: 2.5 });
    await http
      .get('/api/sum')
      .query({ term_one: '1e2', term_two: '1' })
      .expect(200)
      .expect({ result: 101 });
  });

  it('returns only the result and security headers', async () => {
    const response = await http.get('/api/sub').query({ term_one: '4', term_two: '1' }).expect(200);

    expect(response.body).toEqual({ result: 3 });
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-trace-id']).toMatch(/^[a-f0-9]{32}$/);
  });

  it('rejects invalid operands with the standard error body', async () => {
    const response = await http
      .get('/api/sum')
      .query({ term_one: 'abc', term_two: '1' })
      .set('x-trace-id', 'trace_from_header')
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: ['term_one must be a finite decimal number'],
      traceId: 'trace_from_header',
      path: '/api/sum',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    expect(response.headers['x-trace-id']).toBe('trace_from_header');
  });

  it.each([
    [{}, ['term_one is required', 'term_two is required']],
    [{ term_one: '', term_two: '1' }, ['term_one is required']],
    [{ term_one: ' ', term_two: '1' }, ['term_one must be a finite decimal number']],
    [{ term_one: '0x10', term_two: '1' }, ['term_one must be a finite decimal number']],
    [{ term_one: '1e400', term_two: '1' }, ['term_one must be a finite decimal number']],
    [
      { term_one: 'NaN', term_two: 'Infinity' },
      ['term_one must be a finite decimal number', 'term_two must be a finite decimal number'],
    ],
  ])('rejects %j', async (query, message) => {
    const response = await http.get('/api/sum').query(query).expect(400);
    expect(response.body.message).toEqual(message);
    expect(response.body.path).toBe('/api/sum');
  });

  it('rejects an unexpected query parameter', async () => {
    const response = await http
      .get('/api/sum')
      .query({ term_one: '1', term_two: '2', extra: 'no' })
      .expect(400);

    expect(response.body.message).toEqual(['property extra should not exist']);
  });

  it('rejects division by zero and a non-finite product', async () => {
    const division = await http
      .get('/api/div')
      .query({ term_one: '1', term_two: '0' })
      .set('traceparent', TRACEPARENT)
      .expect(400);

    expect(division.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Division by zero is not allowed',
      traceId: TRACE_ID,
      path: '/api/div',
    });
    expect(division.headers['x-trace-id']).toBe(TRACE_ID);

    const overflow = await http
      .get('/api/mul')
      .query({ term_one: '1e308', term_two: '10' })
      .expect(400);
    expect(overflow.body.message).toBe('Operation result is not a finite number');
  });

  it('echoes traceparent, then x-trace-id, then x-request-id, then a generated id', async () => {
    const fromParent = await http
      .get('/api/sum')
      .query({ term_one: '1', term_two: '1' })
      .set('traceparent', TRACEPARENT)
      .set('x-trace-id', 'ignored-trace')
      .set('x-request-id', 'ignored-request')
      .expect(200);
    expect(fromParent.headers['x-trace-id']).toBe(TRACE_ID);

    const fromTrace = await http
      .get('/api/sum')
      .query({ term_one: '1', term_two: '1' })
      .set('x-trace-id', 'trace-abc')
      .set('x-request-id', 'request-abc')
      .expect(200);
    expect(fromTrace.headers['x-trace-id']).toBe('trace-abc');

    const fromRequest = await http
      .get('/api/sum')
      .query({ term_one: '1', term_two: '1' })
      .set('traceparent', 'not-valid')
      .set('x-trace-id', 'bad id')
      .set('x-request-id', 'request-123')
      .expect(200);
    expect(fromRequest.headers['x-trace-id']).toBe('request-123');

    const generated = await http
      .get('/api/sum')
      .query({ term_one: '1', term_two: '2' })
      .expect(200);
    expect(generated.headers['x-trace-id']).toMatch(/^[a-f0-9]{32}$/);
    expect(generated.body).toEqual({ result: 3 });
  });

  it('formats unknown routes', async () => {
    const response = await http.get('/missing').expect(404);
    expect(response.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      path: '/missing',
      traceId: response.headers['x-trace-id'],
    });
    expect(typeof response.body.message).toBe('string');
  });

  it('serves cheap liveness and heap readiness probes outside the api prefix', async () => {
    const live = await http.get('/health/live').expect(200);
    expect(live.body.status).toBe('ok');
    expect(live.body.details.process.status).toBe('up');

    const ready = await http.get('/health/ready').expect(200);
    expect(ready.body.status).toBe('ok');
    expect(ready.body.details.memory_heap.status).toBe('up');

    await http.get('/api/health/live').expect(404);
  });

  it('publishes Swagger UI and the OpenAPI document', async () => {
    const ui = await http.get('/docs').expect(200);
    expect(ui.text).toContain('swagger-ui');

    const spec = await http.get('/docs-json').expect(200);
    expect(spec.body.info.title).toBe('Calculador API');
    expect(spec.body.info.version).toBe('1.0.0');
    expect(Object.keys(spec.body.paths as Record<string, unknown>)).toEqual(
      expect.arrayContaining([
        '/api/sum',
        '/api/sub',
        '/api/mul',
        '/api/div',
        '/health/live',
        '/health/ready',
      ]),
    );
    const parameters = spec.body.paths['/api/div'].get.parameters as Array<{ name: string }>;
    expect(parameters.map((parameter) => parameter.name).sort()).toEqual(['term_one', 'term_two']);
    expect(spec.body.tags.map((tag: { name: string }) => tag.name)).toEqual(
      expect.arrayContaining(['calculator', 'health']),
    );
  });
});

describe('unexpected failures', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(CalculatorService).useValue({
        calculate() {
          throw new Error('disk failed');
        },
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a generic 500 and does not leak the stack', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/sum')
      .query({ term_one: '1', term_two: '1' })
      .expect(500);

    expect(response.body).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
      path: '/api/sum',
    });
    expect(JSON.stringify(response.body)).not.toContain('disk failed');
    expect(response.headers['x-trace-id']).toBe(response.body.traceId);
  });
});

describe('Swagger disabled', () => {
  let app: INestApplication;
  const previous = process.env.SWAGGER_ENABLED;

  beforeAll(async () => {
    process.env.SWAGGER_ENABLED = 'false';
    app = await createTestApp();
  });

  afterAll(async () => {
    if (previous === undefined) {
      delete process.env.SWAGGER_ENABLED;
    } else {
      process.env.SWAGGER_ENABLED = previous;
    }
    await app.close();
  });

  it('does not expose the docs and still calculates', async () => {
    await request(app.getHttpServer() as Server)
      .get('/docs')
      .expect(404);
    await request(app.getHttpServer() as Server)
      .get('/docs-json')
      .expect(404);
    await request(app.getHttpServer() as Server)
      .get('/api/sub')
      .query({ term_one: '4', term_two: '1' })
      .expect(200)
      .expect({ result: 3 });
    await request(app.getHttpServer() as Server)
      .get('/health/live')
      .expect(200);
  });
});

describe('environment validation', () => {
  const previous = process.env.PORT;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previous;
    }
  });

  it('fails fast when PORT is invalid', async () => {
    process.env.PORT = 'nope';
    await expect(createTestApp()).rejects.toThrow(/PORT must be an integer between 1 and 65535/);
  });
});
