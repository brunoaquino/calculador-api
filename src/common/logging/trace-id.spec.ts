import { generateTraceId, resolveTraceId } from './trace-id';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const TRACEPARENT = `00-${TRACE_ID}-00f067aa0ba902b7-01`;

describe('generateTraceId', () => {
  it('returns 32 lowercase hex characters', () => {
    expect(generateTraceId()).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('resolveTraceId', () => {
  const generated = 'generatedtraceid0123456789abcd';

  it('uses the trace-id from a valid traceparent header', () => {
    expect(
      resolveTraceId({
        traceparent: TRACEPARENT,
        'x-trace-id': 'from-trace-header',
        'x-request-id': 'from-request-header',
      }),
    ).toBe(TRACE_ID);
  });

  it('normalizes uppercase traceparent ids and surrounding whitespace', () => {
    expect(
      resolveTraceId({ traceparent: `  00-${TRACE_ID.toUpperCase()}-00f067aa0ba902b7-01  ` }),
    ).toBe(TRACE_ID);
  });

  it('uses the first value when a header is repeated', () => {
    expect(
      resolveTraceId({
        traceparent: [TRACEPARENT, '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-00f067aa0ba902b7-01'],
      }),
    ).toBe(TRACE_ID);
  });

  it('falls through an invalid, empty or all-zero traceparent', () => {
    expect(resolveTraceId({ traceparent: 'not-a-trace' }, () => generated)).toBe(generated);
    expect(resolveTraceId({ traceparent: '' }, () => generated)).toBe(generated);
    expect(resolveTraceId({ traceparent: [] }, () => generated)).toBe(generated);
    expect(
      resolveTraceId(
        { traceparent: '00-00000000000000000000000000000000-00f067aa0ba902b7-01' },
        () => generated,
      ),
    ).toBe(generated);
  });

  it('prefers x-trace-id over x-request-id', () => {
    expect(
      resolveTraceId({
        'x-trace-id': ' trace_id-1 ',
        'x-request-id': 'request-id',
      }),
    ).toBe('trace_id-1');
  });

  it('rejects unsafe x-trace-id values and uses x-request-id', () => {
    expect(
      resolveTraceId({
        'x-trace-id': 'bad id',
        'x-request-id': 'request-id',
      }),
    ).toBe('request-id');
    expect(
      resolveTraceId({
        'x-trace-id': 'a'.repeat(129),
        'x-request-id': 'ok',
      }),
    ).toBe('ok');
    expect(resolveTraceId({ 'x-trace-id': '   ' }, () => generated)).toBe(generated);
  });

  it('accepts a 128 character safe id', () => {
    const id = 'a'.repeat(128);
    expect(resolveTraceId({ 'x-request-id': id })).toBe(id);
  });

  it('uses the first x-request-id when it is repeated', () => {
    expect(resolveTraceId({ 'x-request-id': ['first_id', 'second'] })).toBe('first_id');
  });

  it('generates an id when no header is usable', () => {
    expect(resolveTraceId({}, () => generated)).toBe(generated);
    expect(resolveTraceId({})).toMatch(/^[a-f0-9]{32}$/);
  });
});
