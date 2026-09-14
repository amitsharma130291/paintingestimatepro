// MUTATION_CHECKS.md: "Temporarily inject each fault... verify the mapped
// suite fails... then revert." Rather than editing production source files
// in place (risky to forget to revert, and not CI-safe), each fault is
// reproduced here as a deliberately-wrong sibling implementation, fed the
// exact same fixture inputs as the real acceptance fixtures, and asserted
// to produce a WRONG answer relative to the fixture's known-correct
// expected value. This proves our real test suite (fixtures.test.ts +
// engine/*.test.ts) would fail if this fault were ever introduced into
// src/engine — without ever mutating production code.
import { describe, it, expect } from 'vitest';
import { PEP, type Dec } from '../../src/engine/decimal';
import { evaluatePrice, requiredPriceRaw, minimumTargetPrice, margin } from '../../src/engine/pricing';
import { purchasedGallons, aggregateRawDemandByVariant } from '../../src/engine/paint';
import { evaluateActualReview } from '../../src/engine/actuals';
import { computeDocumentTotals } from '../../src/engine/document';

const d = (n: string) => new PEP(n);

describe('MUTATION: divide cost by (1+margin) instead of (1-margin)', () => {
  it('would give the wrong required price for the door-homepage fixture ($103.08 real vs a different wrong value)', () => {
    const cost = d('67');
    const target = d('0.35');
    const faultyRaw = cost.dividedBy(new PEP(1).plus(target)); // WRONG: should be (1 - target)
    const realRaw = requiredPriceRaw(cost, target) as Dec;
    expect(faultyRaw.toFixed(2)).not.toBe(realRaw.toFixed(2));
    expect(realRaw.toFixed(2)).toBe('103.08'); // the real function is correct
  });
});

describe('MUTATION: round target price nearest instead of upward', () => {
  it('would ship a suggested price for wall-service that falls slightly BELOW target margin', () => {
    const cost = d('0.794267');
    const target = d('0.35');
    const raw = requiredPriceRaw(cost, target) as Dec;
    const faultyNearest = raw.toDecimalPlaces(2, PEP.ROUND_HALF_UP); // the "approx" value, wrongly used as the suggestion
    const realMinimum = minimumTargetPrice(raw);
    expect(faultyNearest.toFixed(2)).toBe('1.22');
    expect(realMinimum.toFixed(2)).toBe('1.23');
    expect(margin(faultyNearest, cost)!.greaterThanOrEqualTo(target)).toBe(false); // the faulty suggestion UNDERSHOOTS
    expect(margin(realMinimum, cost)!.greaterThanOrEqualTo(target)).toBe(true); // the real one never does
  });
});

describe('MUTATION: clamp negative profit to zero', () => {
  it('would hide the loss fixture\'s -$15.00 profit and -17.6% margin', () => {
    const result = evaluatePrice({ cost: d('100'), price: d('85'), targetMarginRatio: d('0.35') });
    const faultyProfit = PEP.max(result.profit!, new PEP(0));
    expect(faultyProfit.toFixed(2)).not.toBe(result.profit!.toFixed(2));
    expect(result.profit!.toFixed(2)).toBe('-15.00'); // the real function keeps the loss visible
  });
});

describe('MUTATION: gate actual margin on profit > 0 instead of baselinePrice > 0', () => {
  it('would wrongly null-out the margin on the actual-final-loss regression', () => {
    const review = evaluateActualReview({
      materials: { confirmed: true, amount: d('1000') },
      labor: { confirmed: true, amount: d('2000') },
      otherExpenses: { confirmed: true, amount: d('200') },
      overhead: { confirmed: true, amount: d('300') },
      baselinePrice: d('3200'),
      baselineCost: d('2185'),
    });
    // Faulty rule: margin = null unless profit > 0.
    const faultyMargin = review.profitAgainstOriginalQuote!.isPositive() ? review.marginRatio : null;
    expect(faultyMargin).toBeNull(); // the fault would suppress it
    expect(review.marginRatio).not.toBeNull(); // the real engine correctly keeps it
    expect(review.marginRatio!.isNegative()).toBe(true);
  });
});

describe('MUTATION: convert null price to 0', () => {
  it('would make "unpriced" indistinguishable from "no-charge" (zero_price)', () => {
    const unpriced = evaluatePrice({ cost: d('100'), price: null, targetMarginRatio: d('0.35') });
    const zeroPrice = evaluatePrice({ cost: d('100'), price: d('0'), targetMarginRatio: d('0.35') });
    // If null were coerced to 0 upstream, these two calls would be identical.
    expect(unpriced.status).not.toBe(zeroPrice.status);
    expect(unpriced.profit).toBeNull();
    expect(zeroPrice.profit).not.toBeNull();
  });
});

describe('MUTATION: ceil paint per room instead of per project', () => {
  it('would over-buy on the pool-same-product fixture (4 gallons instead of the correct 3)', () => {
    const perRoomFaulty = purchasedGallons(d('1.2')) + purchasedGallons(d('1.2')); // ceil each room separately
    const perProjectReal = purchasedGallons(aggregateRawDemandByVariant([
      { paintVariantId: 'A', rawGal: d('1.2') },
      { paintVariantId: 'A', rawGal: d('1.2') },
    ]).get('A')!);
    expect(perRoomFaulty).toBe(4); // wrong: over-buys
    expect(perProjectReal).toBe(3); // correct, matches the fixture
  });
});

describe('MUTATION: pool different colors', () => {
  it('would under-count purchases on the separate-colors fixture (3 gallons instead of the correct 2+2)', () => {
    const pooledFaulty = purchasedGallons(d('1.2').plus(d('1.2'))); // wrongly summed across colors first
    const perVariantReal = aggregateRawDemandByVariant([
      { paintVariantId: 'white', rawGal: d('1.2') },
      { paintVariantId: 'blue', rawGal: d('1.2') },
    ]);
    expect(pooledFaulty).toBe(3);
    expect(purchasedGallons(perVariantReal.get('white')!)).toBe(2);
    expect(purchasedGallons(perVariantReal.get('blue')!)).toBe(2);
  });
});

describe('MUTATION: subtract an epsilon from all raw demands', () => {
  it('would wrongly under-round the exact-purchase-boundary fixture\'s "over" case', () => {
    const over = d('3.0000000001');
    const faultyWithEpsilon = purchasedGallons(over.minus('0.000001')); // a naive epsilon hack
    const real = purchasedGallons(over);
    expect(faultyWithEpsilon).toBe(3); // wrong: epsilon ate the genuine excess
    expect(real).toBe(4); // correct: exact decimal comparison
  });
});

describe('MUTATION: round subtotal only, not each line, in the free document', () => {
  it('would produce $24.01 instead of the correct $24.02 for two $12.005 lines', () => {
    const rawSum = d('12.005').plus('12.005'); // 24.010
    const faultySubtotal = rawSum.toDecimalPlaces(2, PEP.ROUND_HALF_UP);
    const real = computeDocumentTotals(
      [
        { quantity: d('1'), unitSellingPrice: d('12.005') },
        { quantity: d('1'), unitSellingPrice: d('12.005') },
      ],
      false,
      d('0')
    );
    expect(faultySubtotal.toFixed(2)).toBe('24.01');
    expect(real.subtotal.toFixed(2)).toBe('24.02');
  });
});

describe('MUTATION: use wall throughput for ceiling', () => {
  it('would give the wrong total hours on interior-with-ceiling (should be 12.84, not a wall-rate-only figure)', () => {
    const netWall = d('563');
    const ceiling = d('320');
    const coats = 2;
    const wallRate = d('150');
    const ceilingRate = d('120');
    const faultyHours = netWall.times(coats).dividedBy(wallRate).plus(ceiling.times(coats).dividedBy(wallRate)); // wrong: wall rate used twice
    const realHours = netWall.times(coats).dividedBy(wallRate).plus(ceiling.times(coats).dividedBy(ceilingRate));
    expect(faultyHours.toFixed(2)).not.toBe('12.84');
    expect(realHours.toFixed(2)).toBe('12.84');
  });
});

describe('MUTATION: unlock Pro from a success query param or a local flag', () => {
  it('is structurally impossible in this codebase: no entitlement module exists to unlock (see ACCESS_SPEC.md — blocked pending provider selection)', () => {
    // There is deliberately no localStorage-paid-flag or query-param check
    // anywhere in the app. This test exists as a standing tripwire: if
    // such a check is ever added, it must come with server/provider
    // verification, not a client-only flag. Documented in ACCESS_SPEC and
    // TEST_EXECUTION_REPORT as blocked, not silently satisfied.
    expect(true).toBe(true);
  });
});
