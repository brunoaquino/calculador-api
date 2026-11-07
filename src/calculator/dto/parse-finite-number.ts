import { ExactDecimal, SAFE_INTEGER_LIMIT } from '../exact-decimal';

const ALTERNATE_BASE_PREFIX = /^[+-]?0[xob]/i;

export type OperandRejectionReason = 'range' | 'underflow' | 'precision';

export class OperandRejection {
  constructor(readonly reason: OperandRejectionReason) {}
}

export function parseFiniteNumber(value: unknown): number | OperandRejection | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  if (value.length === 0 || /\s/u.test(value)) {
    return undefined;
  }

  if (ALTERNATE_BASE_PREFIX.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  const exact = new ExactDecimal(value);
  if (exact.abs().greaterThan(SAFE_INTEGER_LIMIT)) {
    return new OperandRejection('range');
  }

  const shortest = new ExactDecimal(String(parsed));
  if (exact.equals(shortest)) {
    return parsed;
  }

  if (parsed === 0) {
    return new OperandRejection('underflow');
  }

  return new OperandRejection('precision');
}
