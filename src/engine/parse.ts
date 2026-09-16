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
  /** Inclusive engineering-bound checks (CALCULATION_SPEC.md §1's
   * "Engineering bounds" list) — applied AFTER a value parses successfully,
   * so a malformed string still reports `malformed_number` rather than a
   * confusing range message. Accepts a plain decimal string or an already-
   * constructed Dec so callers can reuse an exported constant directly. */
  min?: string | Dec;
  max?: string | Dec;
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

  // Stryker disable all: unreachable in practice for any GRAMMAR-matched
  // input. GRAMMAR only admits an optional sign, digits, and an optional
  // decimal point -- decimal.js parses such a string without throwing and
  // without ever producing a non-finite value regardless of digit COUNT
  // (verified empirically: a 9,000,001-digit all-digit string still parses
  // to a finite Decimal; decimal.js's own exponent ceiling, which would be
  // the only way to get Infinity/a throw here, is ~9e15 -- reachable only
  // by a string with quadrillions of digits, far beyond any realistic form
  // input). This is defensive, not a documented reachable branch.
  let value: Dec;
  try {
    value = new PEP(trimmed);
  } catch {
    return { kind: 'invalid', code: 'malformed_number', message: `"${raw}" could not be parsed.`, rawText: raw };
  }
  if (!value.isFinite()) {
    return { kind: 'invalid', code: 'non_finite', message: `"${raw}" is not a finite number.`, rawText: raw };
  }
  // Stryker restore all

  // "-0" / "-0.00" normalize to 0 rather than a signed zero.
  if (value.isZero()) value = new PEP(0);

  if (opts.min !== undefined && value.lessThan(opts.min)) {
    return { kind: 'invalid', code: 'below_minimum', message: `"${raw}" must be at least ${opts.min}.`, rawText: raw };
  }
  if (opts.max !== undefined && value.greaterThan(opts.max)) {
    return { kind: 'invalid', code: 'above_maximum', message: `"${raw}" must be at most ${opts.max}.`, rawText: raw };
  }

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

/** Boundary matrix (BOUND-012..061) — the remaining named "Engineering
 * bounds" from CALCULATION_SPEC.md §1, each paired with `ParseOptions.max`
 * (and, for rates, the existing `isPositiveDivisor` floor) at every call
 * site that parses that field. Ratios (overheadRatio/wasteRatio) share one
 * [0,1] bound; geometry/area/trim/hours/money/rate each have their own
 * spec-quoted ceiling. */
export const MAX_RATIO = new PEP('1');
export const MAX_ROOM_DIMENSION_FT = new PEP('100000');
export const MAX_AREA_FT2 = new PEP('1000000000');
export const MAX_TRIM_LENGTH_FT = new PEP('1000000');
export const MAX_HOURS = new PEP('1000000');
export const MAX_RATE = new PEP('1000000'); // throughput, hourly rates -- "rates <=1,000,000 per unit"

/** Project-level structural caps ("at most 500 rooms, 2,000 surfaces,
 * 2,000 document lines per project"). `documentLineCount` has no single
 * canonical array in the data model -- CALCULATION_SPEC.md never defines
 * it further, and it is not the customer document's derived `scopeLines`
 * (whose length is mechanically rooms.length + standalone-surfaces.length,
 * already covered by the room/surface caps below). It is interpreted here
 * as the total of the revision's independently user-appendable line-item
 * arrays -- additionalLabor + otherMaterialLines + otherExpenses -- since
 * those are the project's other unbounded-by-default arrays, the natural
 * sibling to rooms/surfaces. Documented interpretation, not a spec quote.
 */
export const MAX_ROOMS_PER_PROJECT = 500;
export const MAX_SURFACES_PER_PROJECT = 2000;
export const MAX_DOCUMENT_LINES_PER_PROJECT = 2000;

export function isPositiveDivisor(value: Dec): boolean {
  return value.greaterThanOrEqualTo(MIN_POSITIVE_DIVISOR);
}

/** AGG-001..006 — DECISIONS.md #9: "Calculated aggregate limits: inputs
 * have bounds; required selling price has a $1bn cap. Define how
 * aggregates beyond practical display/storage limits are reported, even
 * when individual rows pass limits. No overflow/NaN or silent saturation
 * is acceptable." Every field-level bound above (MAX_AREA_FT2, MAX_RATE,
 * MAX_HOURS, MAX_MONETARY_INPUT, ...) already caps ONE entered value —
 * but summing up to 500 rooms / 2,000 surfaces of otherwise-individually-
 * valid values can still produce a computed AGGREGATE (paint demand,
 * material cost, labor hours, direct cost, overhead, job cost, a
 * suggested/custom price, an actual-cost total) that is technically
 * finite but practically nonsensical to display, store, print, or price
 * against. These constants are the explicit ceiling on those COMPUTED
 * outputs, checked at the aggregation chokepoints
 * (`assembleProjectEstimate`, `evaluateActualReview`) — never at a single
 * input field, which is what the constants above already cover.
 *
 * Deliberately reuses the SAME $1,000,000,000 figure DECISIONS.md #9
 * itself names for "required selling price," rather than inventing a
 * different number for materials/labor/direct-cost/overhead/job-cost/
 * profit/actual-cost totals — one consistent, documented ceiling for
 * every monetary aggregate in the product, matching MAX_MONETARY_INPUT
 * and MAX_REQUIRED_PRICE exactly (not a coincidence: all three name the
 * same practical "nine documented zeros" ceiling for a dollar figure
 * anywhere in this app, whether it is a single entered field or a
 * computed sum). MAX_AGGREGATE_HOURS and MAX_AGGREGATE_GALLONS mirror the
 * same "reuse the existing per-field ceiling for the project-wide total"
 * approach for their own units.
 */
export const MAX_AGGREGATE_MONETARY = MAX_MONETARY_INPUT;
export const MAX_AGGREGATE_HOURS = MAX_HOURS;
export const MAX_AGGREGATE_GALLONS = new PEP('1000000000');
