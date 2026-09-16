// PROPERTY_TESTS.md items 6,7,8,9,13: pooling, split invariance, pooling
// inequality, gallon bound, variant independence.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PEP, type Dec } from '../../src/engine/decimal';
import { aggregateRawDemandByVariant, purchasedGallons, resolvePurchasesByVariant } from '../../src/engine/paint';

const SEED = 20260914;
const NUM_RUNS = 9000;

function toDec(n: number): Dec {
  return new PEP(n).dividedBy(1000); // 3-decimal granularity demand values
}

describe('PROPERTY 6: project pooling is order-independent', () => {
  it('any permutation of the same demand list yields identical totals per variant', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ paintVariantId: fc.constantFrom('A', 'B'), rawGal: fc.integer({ min: 0, max: 50000 }).map(toDec) }), {
          minLength: 1,
          maxLength: 12,
        }),
        (demands) => {
          const shuffled = [...demands].reverse();
          const totalsA = aggregateRawDemandByVariant(demands);
          const totalsB = aggregateRawDemandByVariant(shuffled);
          for (const key of new Set([...totalsA.keys(), ...totalsB.keys()])) {
            const a = totalsA.get(key) ?? new PEP(0);
            const b = totalsB.get(key) ?? new PEP(0);
            if (!a.equals(b)) return false;
          }
          return true;
        }
      ),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});

describe('PROPERTY 7: same-variant split invariance', () => {
  it('splitting one area across two same-variant surfaces vs. one combined surface gives the same raw total', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }).map(toDec), fc.integer({ min: 0, max: 100 }), (total, splitPercent) => {
        const part1 = total.times(splitPercent).dividedBy(100);
        const part2 = total.minus(part1);
        const combined = aggregateRawDemandByVariant([{ paintVariantId: 'A', rawGal: total }]).get('A')!;
        const split = aggregateRawDemandByVariant([
          { paintVariantId: 'A', rawGal: part1 },
          { paintVariantId: 'A', rawGal: part2 },
        ]).get('A')!;
        return combined.equals(split);
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});

describe('PROPERTY 8: pooling inequality (same variant only)', () => {
  it('sum of individual ceilings >= ceiling of the summed demand, for the SAME variant', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }).map(toDec), fc.integer({ min: 0, max: 5000 }).map(toDec), (a, b) => {
        const sumOfCeilings = purchasedGallons(a) + purchasedGallons(b);
        const ceilingOfSum = purchasedGallons(a.plus(b));
        return sumOfCeilings >= ceilingOfSum;
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });

  it('never applies across different variants (each keeps its own ceiling, no cross-variant pooling)', () => {
    const demands = [
      { paintVariantId: 'white', rawGal: new PEP('1.2') },
      { paintVariantId: 'blue', rawGal: new PEP('1.2') },
    ];
    const purchases = resolvePurchasesByVariant(demands, new Map([['white', new PEP('42')], ['blue', new PEP('42')]]));
    const white = purchases.find((p) => p.paintVariantId === 'white')!;
    const blue = purchases.find((p) => p.paintVariantId === 'blue')!;
    expect(white.purchasedGal).toBe(2);
    expect(blue.purchasedGal).toBe(2); // NOT pooled into ceil(2.4)=3
  });
});

describe('PROPERTY 9: gallon bound', () => {
  it('purchasedGallons(raw) is always an integer >= raw, and < raw + 1 (except exact-integer raw)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }).map(toDec), (raw) => {
        const purchased = purchasedGallons(raw);
        return Number.isInteger(purchased) && purchased >= raw.toNumber() && purchased < raw.toNumber() + 1;
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});

describe('PROPERTY 13: variant independence', () => {
  it("changing variant A's demand never changes variant B's purchased quantity", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }).map(toDec), fc.integer({ min: 0, max: 5000 }).map(toDec), fc.integer({ min: 0, max: 5000 }).map(toDec), (aBefore, aAfter, bDemand) => {
        const before = aggregateRawDemandByVariant([
          { paintVariantId: 'A', rawGal: aBefore },
          { paintVariantId: 'B', rawGal: bDemand },
        ]);
        const after = aggregateRawDemandByVariant([
          { paintVariantId: 'A', rawGal: aAfter },
          { paintVariantId: 'B', rawGal: bDemand },
        ]);
        return purchasedGallons(before.get('B')!) === purchasedGallons(after.get('B')!);
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});
