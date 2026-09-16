// CORE pricing states beyond the acceptance fixtures: at-target boundary,
// out_of_supported_range, and monotonicity guards that back the
// property tests.
import { describe, it, expect } from 'vitest';
import { PEP, type Dec } from '../../src/engine/decimal';
import { evaluatePrice, requiredPriceRaw, minimumTargetPrice, margin, markup } from '../../src/engine/pricing';

const d = (n: string) => new PEP(n);

describe('CORE pricing: status boundaries', () => {
  it('CORE-price-01: status is exactly at_target on an exact match, not below/above', () => {
    const r = evaluatePrice({ cost: d('65'), price: d('100'), targetMarginRatio: d('0.35') });
    expect(r.status).toBe('at_target');
  });

  it('CORE-price-02: unpriced vs zero_price are different states and different profit values', () => {
    const unpriced = evaluatePrice({ cost: d('100'), price: null, targetMarginRatio: d('0.35') });
    const zeroPrice = evaluatePrice({ cost: d('100'), price: d('0'), targetMarginRatio: d('0.35') });
    expect(unpriced.status).toBe('unpriced');
    expect(unpriced.profit).toBeNull();
    expect(zeroPrice.status).toBe('zero_price');
    expect(zeroPrice.profit!.toNumber()).toBe(-100); // profit is NOT null at explicit zero price
    expect(zeroPrice.marginRatio).toBeNull(); // margin IS null (undefined) at explicit zero price
  });

  it('CORE-price-03 (BOUND V04): target ratio of 1 throws rather than silently dividing by zero', () => {
    expect(() => requiredPriceRaw(d('100'), d('1'))).toThrow();
  });

  it('CORE-price-04 (BOUND V04): target ratio negative throws', () => {
    expect(() => requiredPriceRaw(d('100'), d('-0.1'))).toThrow();
  });

  it('CORE-price-05 (BOUND V04): extreme cost near a 100% target returns out_of_supported_range, never Infinity', () => {
    const r = evaluatePrice({ cost: d('1000000'), price: d('1'), targetMarginRatio: d('0.9999999999') });
    expect(r.approxPrice).toBeNull();
    expect(r.minimumTargetPrice).toBeNull();
    // and the raw helper never returns a JS/Decimal Infinity value
    const raw = requiredPriceRaw(d('1000000'), d('0.9999999999'));
    expect(raw).toBe('out_of_supported_range');
  });

  it('CORE-price-06: minimumTargetPrice is always >= the raw required price (never rounds down below target)', () => {
    const raw = requiredPriceRaw(d('67'), d('0.35')) as Dec;
    const minPrice = minimumTargetPrice(raw);
    expect(minPrice.greaterThanOrEqualTo(raw)).toBe(true);
    // and margin at that price is >= target
    const check = evaluatePrice({ cost: d('67'), price: minPrice, targetMarginRatio: d('0.35') });
    expect(check.marginRatio!.greaterThanOrEqualTo(d('0.35'))).toBe(true);
  });

  it('CORE-price-07: negative profit and negative margin are never clamped to zero', () => {
    const r = evaluatePrice({ cost: d('100'), price: d('85'), targetMarginRatio: d('0.35') });
    expect(r.profit!.isNegative()).toBe(true);
    expect(r.marginRatio!.isNegative()).toBe(true);
    expect(r.status).toBe('below_cost');
  });

  it('CORE-price-08: markup is distinct from margin and only null-guarded on cost, not price', () => {
    // profit/cost, not profit/price — calls the real exported functions
    // directly (not a reimplementation) so this actually exercises them.
    const price = d('150');
    const cost = d('100');
    const marginResult = margin(price, cost)!; // 50/150 = 33.3%
    const markupResult = markup(price, cost)!; // 50/100 = 50%
    expect(marginResult.equals(markupResult)).toBe(false);
    expect(markupResult.toFixed(4)).toBe('0.5000');
  });

  it('CORE-price-09: margin(price) is null for a non-positive price, never a divide-by-zero result', () => {
    expect(margin(d('0'), d('100'))).toBeNull();
    expect(margin(d('-5'), d('100'))).toBeNull();
  });

  it('CORE-price-10: markup(cost) is null for a non-positive cost, never a divide-by-zero result', () => {
    expect(markup(d('150'), d('0'))).toBeNull();
    expect(markup(d('150'), d('-5'))).toBeNull();
  });
});
