// PROPERTY_TESTS.md items 1-5: margin inverse, minimum-cent guarantee,
// price/cost/required-price monotonicity. Fixed seed for reproducibility
// (documented here; re-run with a different seed occasionally, not on
// every commit — PROPERTY_TESTS.md: "No claim of exhaustive coverage from
// a random run.").
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { PEP, type Dec } from '../../src/engine/decimal';
import { evaluatePrice, requiredPriceRaw, minimumTargetPrice, margin } from '../../src/engine/pricing';

const SEED = 20260914; // recorded seed — TEST_EXECUTION_REPORT.md cites this run
const NUM_RUNS = 9000;

// Bounded generators within v2.1's supported ranges, expressed as cents
// integers to avoid generating float-noise decimal strings.
const centsCost = fc.integer({ min: 0, max: 10_000_000 }); // up to $100,000.00
const centsPrice = fc.integer({ min: 1, max: 10_000_000 }); // positive prices only for these properties
const targetBp = fc.integer({ min: 0, max: 9900 }); // 0.00%..99.00% target margin, in basis points

function toDec(cents: number): Dec {
  return new PEP(cents).dividedBy(100);
}
function ratioFromBp(bp: number): Dec {
  return new PEP(bp).dividedBy(10000);
}

describe('PROPERTY 1: margin inverse', () => {
  it('for cost>=0, 0<=target<1, requiredPrice: margin(requiredPrice, cost) === target (excluding cost=0)', () => {
    fc.assert(
      fc.property(
        centsCost.filter((c) => c > 0),
        targetBp,
        (costCents, bp) => {
          const cost = toDec(costCents);
          const target = ratioFromBp(bp);
          const raw = requiredPriceRaw(cost, target);
          if (raw === 'out_of_supported_range') return true;
          const m = margin(raw, cost)!;
          // exact rational equality up to the engine's configured precision
          return m.minus(target).abs().lessThan('0.0000000001');
        }
      ),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});

describe('PROPERTY 2: minimum-cent guarantee', () => {
  it('margin(minimumTargetPrice, cost) >= target; one cent less would fail (when that cent is still positive)', () => {
    fc.assert(
      fc.property(
        centsCost.filter((c) => c > 0),
        targetBp,
        (costCents, bp) => {
          const cost = toDec(costCents);
          const target = ratioFromBp(bp);
          const raw = requiredPriceRaw(cost, target);
          if (raw === 'out_of_supported_range') return true;
          const minPrice = minimumTargetPrice(raw);
          const m = margin(minPrice, cost)!;
          if (!m.greaterThanOrEqualTo(target)) return false;

          const oneCentLess = minPrice.minus('0.01');
          if (oneCentLess.lessThanOrEqualTo(0)) return true; // guard degenerate case
          const mLess = margin(oneCentLess, cost)!;
          return mLess.lessThan(target);
        }
      ),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});

describe('PROPERTY 3: price monotonicity', () => {
  it('at fixed positive cost, increasing positive selling price cannot decrease margin', () => {
    fc.assert(
      fc.property(centsCost.filter((c) => c > 0), centsPrice, fc.integer({ min: 1, max: 500000 }), (costCents, priceCents, deltaCents) => {
        const cost = toDec(costCents);
        const price1 = toDec(priceCents);
        const price2 = toDec(priceCents + deltaCents);
        const m1 = margin(price1, cost)!;
        const m2 = margin(price2, cost)!;
        return m2.greaterThanOrEqualTo(m1);
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});

describe('PROPERTY 4: cost monotonicity', () => {
  it('at fixed positive selling price, increasing cost cannot increase profit or margin', () => {
    fc.assert(
      fc.property(centsPrice, centsCost, fc.integer({ min: 1, max: 500000 }), (priceCents, costCents, deltaCents) => {
        const price = toDec(priceCents);
        const cost1 = toDec(costCents);
        const cost2 = toDec(costCents + deltaCents);
        const result1 = evaluatePrice({ cost: cost1, price, targetMarginRatio: new PEP('0.35') });
        const result2 = evaluatePrice({ cost: cost2, price, targetMarginRatio: new PEP('0.35') });
        return result2.profit!.lessThanOrEqualTo(result1.profit!) && result2.marginRatio!.lessThanOrEqualTo(result1.marginRatio!);
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});

describe('PROPERTY 5: required-price monotonicity', () => {
  it('increased cost cannot reduce the required price, within the supported range', () => {
    fc.assert(
      fc.property(centsCost.filter((c) => c > 0), fc.integer({ min: 1, max: 500000 }), targetBp, (costCents, deltaCents, bp) => {
        const target = ratioFromBp(bp);
        const raw1 = requiredPriceRaw(toDec(costCents), target);
        const raw2 = requiredPriceRaw(toDec(costCents + deltaCents), target);
        if (raw1 === 'out_of_supported_range' || raw2 === 'out_of_supported_range') return true;
        return raw2.greaterThanOrEqualTo(raw1);
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });

  it('increased target (at fixed cost) cannot reduce the required price', () => {
    fc.assert(
      fc.property(centsCost.filter((c) => c > 0), fc.integer({ min: 0, max: 9800 }), fc.integer({ min: 1, max: 99 }), (costCents, bp, deltaBp) => {
        const cost = toDec(costCents);
        const raw1 = requiredPriceRaw(cost, ratioFromBp(bp));
        const raw2 = requiredPriceRaw(cost, ratioFromBp(Math.min(bp + deltaBp, 9999)));
        if (raw1 === 'out_of_supported_range' || raw2 === 'out_of_supported_range') return true;
        return raw2.greaterThanOrEqualTo(raw1);
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});
