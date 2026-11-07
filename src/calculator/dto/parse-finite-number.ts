const ALTERNATE_BASE_PREFIX = /^[+-]?0[xob]/i;

export function parseFiniteNumber(value: unknown): number | undefined {
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

  return parsed;
}
