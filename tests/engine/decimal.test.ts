// CORE-026, CORE-030, NUM-DEC-001: rounding symmetry for negative values,
// exact decimal arithmetic with no binary-float artifact, and sufficient
// precision headroom for chained divisions that produce a repeating decimal.
import { describe, it, expect } from 'vitest';
import { PEP, halfUp } from '../../src/engine/decimal';
import { wallOrCeilingHours } from '../../src/engine/labor';
import { directCost, overheadAmount, estimatedJobCost } from '../../src/engine/cost';

describe('CORE-026: HALF_UP rounds negative ties away from zero (symmetric), not toward +Infinity', () => {
  it('-0.005 rounds to -0.01, not 0.00 or -0.00', () => {
    expect(halfUp(new PEP('-0.005'), 2).toFixed(2)).toBe('-0.01');
  });
  it('-0.015 rounds to -0.02', () => {
    expect(halfUp(new PEP('-0.015'), 2).toFixed(2)).toBe('-0.02');
  });
});

describe('CORE-030: exact decimal arithmetic has no binary-float artifact', () => {
  it('0.1 + 0.2 is exactly 0.3, unlike native JS floating point (0.1+0.2=0.30000000000000004)', () => {
    expect(new PEP('0.1').plus('0.2').toString()).toBe('0.3');
    // Sanity check this is a genuine distinction, not a vacuous assertion.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('a sum landing exactly on a whole gallon never gets nudged by float noise before ceiling', () => {
    // 3 * 0.1 in native JS is 0.30000000000000004; confirm our decimal path avoids that.
    const sum = new PEP('0.1').plus('0.1').plus('0.1');
    expect(sum.toString()).toBe('0.3');
  });
});

describe('NUM-DEC-001: precision headroom for a chained division that produces a repeating decimal', () => {
  it('110 sqft ceiling, 5 coats, 187 ft2/hr throughput, $139.23/hr: hours = 550/187 does not terminate, but the labor cost it feeds into (819/2 exactly, a mathematically exact $409.50) must not lose enough precision to flip a later HALF_UP tie by a cent', () => {
    // Found via 205,000-fixture differential fuzzing against an independent
    // Python decimal oracle (docs/numerical_oracle.py) -- 5 of 205,000
    // fixtures diverged from the oracle by exactly one cent, always at a
    // spot where the TRUE (exact-rational) job cost lands precisely on a
    // HALF_UP rounding tie. Verified independently with Python
    // fractions.Fraction (exact, no floating/decimal precision at all):
    // hours = 550/187 (repeating); laborCost = hours * 139.23 = 819/2 =
    // 409.5 EXACTLY (the 17 in 187's factorization exactly cancels a
    // hidden factor of 17 in 13923); directCost = 658.5 EXACTLY; overhead
    // = 658.5 * 0.310 = 204.135 EXACTLY (an exact tie); jobCost = 862.635
    // EXACTLY (also an exact tie) -- which HALF_UP must round UP to
    // 862.64. At precision 50, `wallOrCeilingHours` truncates 550/187 to
    // 50 significant digits *before* the multiply that would otherwise
    // exactly cancel the repeating denominator, leaving a ~1e-47 residual
    // that survives into jobCost as 862.63499999999999999999999999999999
    // 999999999999999 -- just under the tie -- and wrongly rounds to
    // 862.63.
    const hours = wallOrCeilingHours(new PEP('110'), 5, new PEP('187'));
    const laborCost = hours.times('139.23');
    const dc = directCost(new PEP('129'), laborCost, new PEP('120'));
    const oh = overheadAmount(dc, new PEP('0.310'));
    const jc = estimatedJobCost(dc, oh);
    expect(jc.toFixed(2)).toBe('862.64');
  });
});
