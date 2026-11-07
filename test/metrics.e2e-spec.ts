import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import request from 'supertest';
import { createTestApp } from './create-test-app';

describe('Prometheus metrics', () => {
  let app: INestApplication;
  let http: request.Agent;

  beforeEach(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer() as Server);
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves /metrics outside the api prefix', async () => {
    const first = await http.get('/metrics').expect(200);
    expect(first.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(first.text).toContain('process_resident_memory_bytes');
    const memory = first.text
      .split('\n')
      .find((line) => line.startsWith('process_resident_memory_bytes'));
    expect(memory).toContain('service="calculador-api"');
    expect(memory).toContain('version="1.2.0"');
    expect(sampleLines(first.text, 'http_requests_total')).toEqual([]);

    const second = await http.get('/metrics').expect(200);
    expect(sampleLines(second.text, 'http_requests_total')).toEqual([]);

    await http.get('/api/metrics').expect(404);
  });

  it('counts a successful sum on the route template', async () => {
    await http
      .get('/api/sum')
      .query({ term_one: '2', term_two: '3' })
      .expect(200)
      .expect({ result: 5 });

    const body = (await http.get('/metrics').expect(200)).text;
    expect(
      metricValue(body, 'http_requests_total', {
        method: 'GET',
        route: '/api/sum',
        status_code: '200',
      }),
    ).toBe(1);
    expect(
      metricValue(body, 'calculator_operations_total', {
        operation: 'sum',
        result: 'success',
      }),
    ).toBe(1);
    expect(sampleLines(body, 'http_requests_total')).toHaveLength(1);
    expect(sampleLines(body, 'calculator_operations_total')).toHaveLength(1);
    expect(body).not.toContain('route="/metrics"');
    expect(body).not.toContain('term_one');
    expect(body).not.toContain('term_two');
    expect(body).not.toContain('?');
  });

  it('counts a rejected division by zero', async () => {
    await http.get('/api/div').query({ term_one: '1', term_two: '0' }).expect(400);

    const body = (await http.get('/metrics').expect(200)).text;
    expect(
      metricValue(body, 'http_requests_total', {
        method: 'GET',
        route: '/api/div',
        status_code: '400',
      }),
    ).toBe(1);
    expect(
      metricValue(body, 'calculator_operations_total', {
        operation: 'div',
        result: 'rejected',
      }),
    ).toBe(1);
    expect(
      metricValue(body, 'calculator_operations_total', {
        operation: 'div',
        result: 'success',
      }),
    ).toBe(0);
    expect(body).not.toContain('term_one');
    expect(body).not.toContain('?');
  });

  it('counts an unknown path as unmatched', async () => {
    await http.get('/no-such-route').query({ q: 'secret' }).expect(404);

    const body = (await http.get('/metrics').expect(200)).text;
    expect(
      metricValue(body, 'http_requests_total', {
        method: 'GET',
        route: 'unmatched',
        status_code: '404',
      }),
    ).toBe(1);
    expect(sampleLines(body, 'http_requests_total')).toHaveLength(1);
    expect(sampleLines(body, 'calculator_operations_total')).toEqual([]);
    expect(body).not.toContain('no-such-route');
    expect(body).not.toContain('secret');
    expect(body).not.toContain('?');
  });
});

function sampleLines(body: string, name: string): string[] {
  return body.split('\n').filter((line) => line.startsWith(`${name}{`));
}

function metricValue(body: string, name: string, labels: Record<string, string>): number {
  const line = sampleLines(body, name).find((candidate) =>
    Object.entries(labels).every(([key, value]) => candidate.includes(`${key}="${value}"`)),
  );
  if (line === undefined) {
    return 0;
  }

  return Number(line.slice(line.lastIndexOf('}') + 1).trim());
}
