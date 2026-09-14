// CORE-026, CORE-030: rounding symmetry for negative values, and exact
// decimal arithmetic with no binary-float artifact.
import { describe, it, expect } from 'vitest';
import { PEP, halfUp } from '../../src/engine/decimal';

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
