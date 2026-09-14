// UX bug fix regression: money() must place the sign before the currency
// symbol ("-$15.00"), not after it ("$-15.00"). Found manually while
// testing the Pro app's Actual Review tab with a loss scenario.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { money } from '../../src/components/tools/shared';

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
