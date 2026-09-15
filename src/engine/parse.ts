import { PEP, type Dec } from './decimal';
import type { FieldState } from './types';

/**
 * Numeric grammar — resolves DECISIONS.md #1 ("Browser numeric grammar").
 * This is a documented product decision, not an inevitability of the spec.
 *
 * Accepted: optional surrounding whitespace (trimmed); an optional single
 * leading sign (+/-, only meaningful when `allowNegative`); digits with
 * leading zeros ("007"); an optional single decimal point; up to
 * `maxFractionDigits` (default 10) digits after it. "-0"/"-0.00" normalize
 * to "0".
 *
 * Rejected (invalid, never silently coerced to 0 or truncated): empty
 * interior digits ("." or "-"), more than one decimal point, more than one
 * sign, scientific notation ("1e5"), thousands separators ("1,234"), any
 * unit/currency suffix ("12ft", "$12"), any other non [0-9.+-] character,
 * and more than `maxFractionDigits` fractional digits.
 *
 * A field left completely blank is `missing`, never `invalid` — CORE's
 * "missing vs invalid vs valid-zero" trichotomy (CALCULATION_SPEC §1).
 */
export interface ParseOptions {
  allowNegative?: boolean;
  maxFractionDigits?: number;
}

const GRAMMAR = /^[+-]?(\d+)(\.(\d+))?$/;

export function parseDecimalField(raw: string | null | undefined, opts: ParseOptions = {}): FieldState<Dec> {
  if (raw === null || raw === undefined) return { kind: 'missing' };
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'missing' };

  const match = GRAMMAR.exec(trimmed);
  if (!match) {
    return {
      kind: 'invalid',
      code: 'malformed_number',
      message: `"${raw}" is not a plain decimal number. Whole/decimal digits only — no units, commas, or scientific notation.`,
      rawText: raw,
    };
  }

  const fractionDigits = match[3]?.length ?? 0;
  const maxFractionDigits = opts.maxFractionDigits ?? 10;
  if (fractionDigits > maxFractionDigits) {
    return {
      kind: 'invalid',
      code: 'too_many_fraction_digits',
      message: `"${raw}" has more than ${maxFractionDigits} digits after the decimal point.`,
      rawText: raw,
    };
  }

  const isNegative = trimmed.startsWith('-');
  if (isNegative && !opts.allowNegative) {
    return {
      kind: 'invalid',
      code: 'negative_not_allowed',
      message: `"${raw}" must not be negative.`,
      rawText: raw,
    };
  }

  let value: Dec;
  try {
    value = new PEP(trimmed);
  } catch {
    return { kind: 'invalid', code: 'malformed_number', message: `"${raw}" could not be parsed.`, rawText: raw };
  }
  if (!value.isFinite()) {
    return { kind: 'invalid', code: 'non_finite', message: `"${raw}" is not a finite number.`, rawText: raw };
  }

  // "-0" / "-0.00" normalize to 0 rather than a signed zero.
  if (value.isZero()) value = new PEP(0);

  return { kind: 'valid', value };
}

/** A nonnegative-integer count field (door/window counts, coats, etc.). */
export function parseCountField(raw: string | null | undefined, opts: { min?: number; max?: number } = {}): FieldState<number> {
  if (raw === null || raw === undefined) return { kind: 'missing' };
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'missing' };
  if (!/^\d+$/.test(trimmed)) {
    return { kind: 'invalid', code: 'malformed_integer', message: `"${raw}" is not a whole number.`, rawText: raw };
  }
  const n = Number.parseInt(trimmed, 10);
  if (opts.min !== undefined && n < opts.min) {
    return { kind: 'invalid', code: 'below_minimum', message: `"${raw}" must be at least ${opts.min}.`, rawText: raw };
  }
  if (opts.max !== undefined && n > opts.max) {
    return { kind: 'invalid', code: 'above_maximum', message: `"${raw}" must be at most ${opts.max}.`, rawText: raw };
  }
  return { kind: 'valid', value: n };
}

/** CALCULATION_SPEC.md §1: "door count <=100,000." Applies to every opening
 * count (quick doors/windows, and each detailed opening entry's count). */
export const MAX_OPENING_COUNT = 100000;

/** Defense-in-depth range check for a count field ALREADY typed as a plain
 * `number` in the domain model (Room.quick.doorCount/windowCount,
 * OpeningEntry.count) — used at calculation time so a negative or
 * out-of-range value that reached the model by any path (a direct object
 * mutation, a future code path, not just the interactive UI) can never
 * silently inflate an area calculation. Import validation
 * (checkRequiredInt) is the primary gate for imported data; this is the
 * calculation engine's own independent guard, matching V6-04's finding
 * that those two gates had drifted out of agreement. */
export function isValidOpeningCount(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= MAX_OPENING_COUNT;
}

/** ENGINEERING BOUNDS — CALCULATION_SPEC §1. A near-zero positive divisor
 * (throughput, coverage) is rejected outright rather than allowed to blow
 * an intermediate quotient up toward the aggregate cap silently
 * (DECISIONS.md #2). */
export const MIN_POSITIVE_DIVISOR = new PEP('0.000000001');
export const MAX_MONETARY_INPUT = new PEP('1000000000');
export const MONETARY_WARN_THRESHOLD = new PEP('1000000');
export const MAX_REQUIRED_PRICE = new PEP('1000000000');

export function isPositiveDivisor(value: Dec): boolean {
  return value.greaterThanOrEqualTo(MIN_POSITIVE_DIVISOR);
}
