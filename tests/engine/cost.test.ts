// COST: supplies-allowance modes (only the active mode contributes) and
// the overhead/direct-cost build-up.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { suppliesAllowance, materialsTotal, directCost, overheadAmount, estimatedJobCost } from '../../src/engine/cost';

const d = (n: string) => new PEP(n);

describe('COST: materials, supplies allowance, overhead', () => {
  it('COST-01: allowance mode "none" contributes zero regardless of stale flat/percent fields', () => {
    const a = suppliesAllowance({ mode: 'none', flatAmount: d('999'), paintPercentRatio: d('0.5') }, d('100'));
    expect(a.toNumber()).toBe(0);
  });

  it('COST-02: allowance mode "flat" ignores paintPercentRatio', () => {
    const a = suppliesAllowance({ mode: 'flat', flatAmount: d('25'), paintPercentRatio: d('0.9') }, d('100'));
    expect(a.toNumber()).toBe(25);
  });

  it('COST-03: allowance mode "paintPercent" ignores flatAmount and scales off paint cost only', () => {
    const a = suppliesAllowance({ mode: 'paintPercent', flatAmount: d('999'), paintPercentRatio: d('0.1') }, d('200'));
    expect(a.toNumber()).toBe(20);
  });

  it('COST-04 (mutation guard): allowance never applies to the full materials total, only to paint cost', () => {
    const paintCost = d('100');
    const otherMaterials = d('900'); // large, unrelated line — must not affect the percent-of-paint allowance
    const a = suppliesAllowance({ mode: 'paintPercent', paintPercentRatio: d('0.1') }, paintCost);
    expect(a.toNumber()).toBe(10); // 10% of the $100 paint cost, not of $1000 total materials
    const total = materialsTotal(paintCost, otherMaterials, a);
    expect(total.toNumber()).toBe(1010);
  });

  it('COST-05: overhead is a single allocation method — percent of full direct cost', () => {
    const dc = directCost(d('620'), d('1280'), d('0'));
    const oh = overheadAmount(dc, d('0.15'));
    expect(oh.toNumber()).toBe(285); // matches the homepage's original illustrative figure exactly
    expect(estimatedJobCost(dc, oh).toNumber()).toBe(2185);
  });

  it('COST-06: travel/expense lines add to otherExpenses, which itself feeds overhead (no double burden)', () => {
    // Travel $50 as a direct expense: overhead should apply to it once, via directCost, not as a second bucket.
    const dc = directCost(d('1000'), d('500'), d('50'));
    expect(dc.toNumber()).toBe(1550);
    const oh = overheadAmount(dc, d('0.15'));
    expect(oh.toNumber()).toBeCloseTo(232.5, 5);
  });
});
