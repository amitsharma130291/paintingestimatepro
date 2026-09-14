// UX bug fix regression: money() must place the sign before the currency
// symbol ("-$15.00"), not after it ("$-15.00"). Found manually while
// testing the Pro app's Actual Review tab with a loss scenario.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { money, parseCoatsInput } from '../../src/components/tools/shared';

describe('money() formatting', () => {
  it('formats a positive amount as $X.XX', () => {
    expect(money(new PEP('1150.29'))).toBe('$1150.29');
  });
  it('formats a negative amount with the sign BEFORE the dollar sign', () => {
    expect(money(new PEP('-1399.71'))).toBe('-$1399.71');
  });
  it('formats zero without a sign', () => {
    expect(money(new PEP('0'))).toBe('$0.00');
  });
  it('formats null/undefined as an em dash', () => {
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
  });
});

// BOUND-003/004/005 regression: found by an audit reading the Pro app's
// per-surface Coats field handler, `Number.parseInt(v, 10) || 1`. That
// falsy-zero JS idiom turns "0" into 1 (silently wrong, not rejected),
// accepts any value above the spec's 5-coat ceiling with no bound, and
// truncates "1.5" to 1 instead of rejecting a non-integer entirely —
// directly contradicting CALCULATION_SPEC.md's "coats integer 1..5" and
// "do not truncate meaningful quantities silently."
describe('parseCoatsInput(): the Pro app\'s per-surface coats override, matching CALCULATION_SPEC\'s 1..5 integer bound', () => {
  it('blank input clears the override (falls back to the default elsewhere)', () => {
    expect(parseCoatsInput('')).toBeNull();
    expect(parseCoatsInput('   ')).toBeNull();
  });
  it('rejects "0" instead of silently coercing it to 1 (BOUND-003)', () => {
    expect(parseCoatsInput('0')).toBe('reject');
  });
  it('rejects a value above 5 instead of silently accepting it (BOUND-004)', () => {
    expect(parseCoatsInput('6')).toBe('reject');
  });
  it('rejects a non-integer instead of silently truncating it (BOUND-005)', () => {
    expect(parseCoatsInput('1.5')).toBe('reject');
  });
  it('accepts every integer in the valid 1..5 range', () => {
    for (const n of [1, 2, 3, 4, 5]) expect(parseCoatsInput(String(n))).toBe(n);
  });
  it('rejects malformed text', () => {
    expect(parseCoatsInput('abc')).toBe('reject');
  });
});
