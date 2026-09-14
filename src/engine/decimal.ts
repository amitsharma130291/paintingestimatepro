import Decimal from 'decimal.js';

// CALCULATION_SPEC.md §1: "Use a decimal-arithmetic implementation, precision
// at least 40 significant digits, rather than binary floats for totals and
// purchasing." 50 gives headroom above the required 40 for chained
// divisions (e.g. Price Book Health's paint-per-unit) without ever needing
// to fall back to a binary float anywhere in the engine.
export const PEP = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

export type Dec = Decimal;

/** CALCULATION_SPEC §4: "No epsilon: exact decimal boundaries apply." */
export function ceilDecimal(value: Dec): Dec {
  return value.toDecimalPlaces(0, Decimal.ROUND_CEIL);
}

/** HALF_UP to a fixed number of places, using exact decimal semantics (no
 * banker's rounding, no binary-float representation error). */
export function halfUp(value: Dec, places: number): Dec {
  return value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
}

export function toMoneyString(value: Dec): string {
  return halfUp(value, 2).toFixed(2);
}

export function toPercentString(ratio: Dec, places = 1): string {
  return halfUp(ratio.times(100), places).toFixed(places);
}
