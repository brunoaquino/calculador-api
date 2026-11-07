import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Server } from 'node:http';
import { Writable } from 'node:stream';
import request from 'supertest';
import { setLogDestination } from '../src/common/logging/logger.options';
import { createTestApp } from './create-test-app';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const TRACEPARENT = `00-${TRACE_ID}-00f067aa0ba902b7-01`;

@Controller('boom')
class BoomController {
  @Get()
  fail(): void {
    throw new Error('disk failed');
  }
}

@Module({
  controllers: [BoomController],
})
class BoomModule {}

describe('unhandled exceptions', () => {
  let app: INestApplication | undefined;
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const previousLogLevel = process.env.LOG_LEVEL;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'info';
    setLogDestination(stream);
    app = await createTestApp(undefined, [BoomModule]);
  });

  beforeEach(() => {
    chunks.length = 0;
  });

  afterAll(async () => {
    setLogDestination(undefined);
    if (previousLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previousLogLevel;
    }
    await app?.close();
  });

  function records(): Array<Record<string, unknown>> {
    return chunks
      .join('')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it('logs Calculation completed at info with the request trace id', async () => {
    const response = await request(httpServer())
      .get('/api/sum')
      .query({ term_one: '0.1', term_two: '0.2' })
      .set('traceparent', TRACEPARENT)
      .expect(200);

    expect(response.body).toEqual({ result: 0.3 });
    expect(response.headers['x-trace-id']).toBe(TRACE_ID);

    const completed = records().filter((line) => line.msg === 'Calculation completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      level: 'info',
      traceId: TRACE_ID,
      context: 'CalculatorService',
      operation: 'sum',
      termOne: 0.1,
      termTwo: 0.2,
      result: 0.3,
      msg: 'Calculation completed',
    });
  });

  it('returns a generic 500 and logs one Unhandled exception with the request trace id', async () => {
    const response = await request(httpServer())
      .get('/api/boom')
      .set('traceparent', TRACEPARENT)
      .expect(500);

    expect(response.body).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
      traceId: TRACE_ID,
      path: '/api/boom',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    expect(response.headers['x-trace-id']).toBe(TRACE_ID);
    expect(JSON.stringify(response.body)).not.toContain('disk failed');

    const unhandled = records().filter((line) => line.msg === 'Unhandled exception');
    expect(unhandled).toHaveLength(1);
    const line = unhandled[0];
    expect(line).toMatchObject({
      level: 'error',
      traceId: TRACE_ID,
      context: 'GlobalExceptionFilter',
      msg: 'Unhandled exception',
    });
    const err = line?.err as { type?: string; message?: string; stack?: string };
    expect(err.type).toBe('Error');
    expect(err.message).toBe('disk failed');
    expect(err.stack).toContain('disk failed');
  });

  function httpServer(): Server {
    if (!app) {
      throw new Error('application was not started');
    }
    return app.getHttpServer() as Server;
  }
});
