import Decimal from 'decimal.js';

// Local clone so arithmetic never mutates Decimal's global configuration.
export const ExactDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
});

export const SAFE_INTEGER_LIMIT = Number.MAX_SAFE_INTEGER;
