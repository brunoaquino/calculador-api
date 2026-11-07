import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/i;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ZERO_TRACE_ID = '0'.repeat(32);

export function generateTraceId(): string {
  return randomUUID().replaceAll('-', '');
}

export function resolveTraceId(
  headers: IncomingHttpHeaders,
  generateId: () => string = generateTraceId,
): string {
  const fromTraceparent = traceIdFromTraceparent(firstHeader(headers.traceparent));
  if (fromTraceparent) {
    return fromTraceparent;
  }

  const fromTraceHeader = sanitizeId(firstHeader(headers['x-trace-id']));
  if (fromTraceHeader) {
    return fromTraceHeader;
  }

  const fromRequestHeader = sanitizeId(firstHeader(headers['x-request-id']));
  if (fromRequestHeader) {
    return fromRequestHeader;
  }

  return generateId();
}

function traceIdFromTraceparent(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = TRACEPARENT.exec(value.trim());
  if (!match?.[1]) {
    return undefined;
  }

  const traceId = match[1].toLowerCase();
  if (traceId === ZERO_TRACE_ID) {
    return undefined;
  }

  return traceId;
}

function sanitizeId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!SAFE_ID.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
