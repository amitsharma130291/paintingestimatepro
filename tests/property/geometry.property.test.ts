// PROPERTY_TESTS.md items 10,11,12: opening deduction, labor linearity,
// coats/waste monotonicity.
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { PEP } from '../../src/engine/decimal';
import { netWallArea } from '../../src/engine/geometry';
import { wallOrCeilingHours } from '../../src/engine/labor';
import { rawDemandGal } from '../../src/engine/paint';

const SEED = 20260914;
const NUM_RUNS = 9000;
const toDec = (n: number) => new PEP(n);

describe('PROPERTY 10: opening deduction', () => {
  it('for deductions between 0 and gross, net = gross - deduction; beyond gross, invalid (never a valid negative/zero final)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }).map(toDec), fc.integer({ min: 0, max: 200000 }).map(toDec), (gross, deduction) => {
        const r = netWallArea(gross, deduction, true);
        if (deduction.lessThanOrEqualTo(gross)) {
          return r.valid === true && r.area.equals(gross.minus(deduction));
        }
        return r.valid === false;
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});

describe('PROPERTY 11: application labor linearity', () => {
  // NOTE (found by this property test, seed 20260914, counterexample
  // [area=1, coats=1, throughput=290]): a strict `.equals()` check here
  // originally failed. Root cause is NOT a formula bug — area*coats/290 is
  // a non-terminating decimal (290 = 2*5*29), so computing it once and
  // doubling versus computing (2*area)/290 directly are two independently
  // rounded results at the engine's 50-significant-digit precision floor.
  // They differed by 1e-52 (h1*2 = ...034482, h2 = ...034483) — twelve
  // digits past the spec's required 40-significant-digit floor, and
  // financially meaningless at any real display precision. The formula
  // itself is exactly linear; only bit-for-bit equality of two
  // independently-rounded infinite decimals is not guaranteed, which is
  // expected decimal-arithmetic behavior, not a defect. Tolerance below is
  // 1e-40 — at the precision floor, nowhere near a display digit.
  const TOLERANCE = new PEP('1e-40');

  it('doubling valid area at fixed rate/coats doubles raw hours (within the engine precision floor)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }).map(toDec), fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 500 }).map(toDec), (area, coats, throughput) => {
        const h1 = wallOrCeilingHours(area, coats, throughput);
        const h2 = wallOrCeilingHours(area.times(2), coats, throughput);
        return h2.minus(h1.times(2)).abs().lessThan(TOLERANCE);
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});

describe('PROPERTY 12: coats/waste monotonicity', () => {
  it('increasing coats cannot decrease raw paint demand', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }).map(toDec),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 100 }).map((n) => toDec(n).dividedBy(100)),
        fc.integer({ min: 1, max: 1000 }).map(toDec),
        (area, coats1, extraCoats, waste, coverage) => {
          const demand1 = rawDemandGal(area, coats1, waste, coverage);
          const demand2 = rawDemandGal(area, coats1 + extraCoats, waste, coverage);
          return demand2.greaterThanOrEqualTo(demand1);
        }
      ),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });

  it('increasing waste ratio cannot decrease raw paint demand', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }).map(toDec),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 50 }).map((n) => toDec(n).dividedBy(100)),
        fc.integer({ min: 0, max: 50 }).map((n) => toDec(n).dividedBy(100)),
        fc.integer({ min: 1, max: 1000 }).map(toDec),
        (area, coats, waste1, waste2Extra, coverage) => {
          const demand1 = rawDemandGal(area, coats, waste1, coverage);
          const demand2 = rawDemandGal(area, coats, waste1.plus(waste2Extra), coverage);
          return demand2.greaterThanOrEqualTo(demand1);
        }
      ),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});
