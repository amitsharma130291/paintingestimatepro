// COST-002, COST-006, COST-009, COST-010, COST-011, COST-012, COST-013,
// COST-016, COST-018: exact matrix-quoted labor/materials/overhead
// scenarios (CALCULATION_SPEC.md section 5) not yet covered by any test
// using these specific figures.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { toMoneyString } from '../../src/engine/decimal';
import { wallOrCeilingHours, doorHours, surfaceApplicationLaborCost } from '../../src/engine/labor';
import { suppliesAllowance, otherMaterialCost, materialsTotal, overheadAmount, estimatedJobCost } from '../../src/engine/cost';

const d = (n: string) => new PEP(n);

describe('COST-002: a ceiling of 320ft^2, 2 coats, throughput 120, rate $32/hr computes 16/3 hours and $170.666... (displays $170.67)', () => {
  it('matches the exact matrix figures through the real production functions', () => {
    const hours = wallOrCeilingHours(d('320'), 2, d('120'));
    expect(hours.toString()).toBe(new PEP(16).dividedBy(3).toString());
    const cost = surfaceApplicationLaborCost([{ hours, loadedHourlyRate: d('32') }]);
    expect(cost.toString()).toBe(new PEP(170).plus(new PEP(2).dividedBy(3)).toString()); // 170.6666...
    expect(toMoneyString(cost)).toBe('170.67'); // HALF_UP display rounding
  });
});

describe('COST-006: a door with only 1 painted side never implicitly bills for a second side', () => {
  it('count=1, coats=2, hoursPerSidePerCoat=0.75, sides=1 -> exactly 1.5 hours, $48.00 at $32/hr', () => {
    const hours = doorHours(1, 1, 2, d('0.75'));
    expect(hours.toString()).toBe('1.5');
    const cost = surfaceApplicationLaborCost([{ hours, loadedHourlyRate: d('32') }]);
    expect(toMoneyString(cost)).toBe('48.00');
  });

  it('the same door with sides=2 costs exactly double -- proving sides=1 truly has no hidden second-side charge', () => {
    const oneSide = doorHours(1, 1, 2, d('0.75'));
    const twoSides = doorHours(1, 2, 2, d('0.75'));
    expect(twoSides.toString()).toBe(oneSide.times(2).toString());
  });
});

describe('COST-009/010/011: supplies allowance modes with the matrix\'s exact paint=$126, itemized supplies=$20 fixture', () => {
  const paintCost = d('126');
  const otherSupplies = otherMaterialCost([{ quantity: d('1'), unitCost: d('20') }]);

  it('COST-009: allowance mode "none" -> materials = $146.00, no hidden default allowance', () => {
    const allowance = suppliesAllowance({ mode: 'none' }, paintCost);
    expect(allowance.isZero()).toBe(true);
    const materials = materialsTotal(paintCost, otherSupplies, allowance);
    expect(toMoneyString(materials)).toBe('146.00');
  });

  it('COST-010: allowance mode "flat" at $10 -> materials = $156.00, with the allowance itself shown as exactly $10 (not blended into the other totals)', () => {
    const allowance = suppliesAllowance({ mode: 'flat', flatAmount: d('10') }, paintCost);
    expect(toMoneyString(allowance)).toBe('10.00');
    const materials = materialsTotal(paintCost, otherSupplies, allowance);
    expect(toMoneyString(materials)).toBe('156.00');
  });

  it('COST-011: allowance mode "paintPercent" at 10% -> $12.60 allowance (10% of PAINT ONLY, $126, not all $146 of materials) -> materials = $158.60', () => {
    const allowance = suppliesAllowance({ mode: 'paintPercent', paintPercentRatio: d('0.10') }, paintCost);
    expect(toMoneyString(allowance)).toBe('12.60'); // 126*0.10, NOT 146*0.10=14.60
    const materials = materialsTotal(paintCost, otherSupplies, allowance);
    expect(toMoneyString(materials)).toBe('158.60');
  });
});

describe('COST-012/013: switching allowance mode never blends a stale value from the previously-active mode', () => {
  const paintCost = d('126');

  it('COST-012: switching flat($10) -> none while the old 10% ratio is still sitting in the (now inactive) ratio field contributes nothing', () => {
    const allowance = suppliesAllowance({ mode: 'none', flatAmount: d('10'), paintPercentRatio: d('0.10') }, paintCost);
    expect(allowance.isZero()).toBe(true); // neither the stale $10 nor the stale 10% ratio leaks in
  });

  it('COST-013: switching flat($10) -> paintPercent(10%) uses ONLY the 10% ratio ($12.60), never $10+$12.60=$22.60', () => {
    const allowance = suppliesAllowance({ mode: 'paintPercent', flatAmount: d('10'), paintPercentRatio: d('0.10') }, paintCost);
    expect(toMoneyString(allowance)).toBe('12.60');
    expect(toMoneyString(allowance)).not.toBe('22.60');
  });
});

describe('COST-016: an itemized supplies/other-material line of quantity 3 at $2.50 each adds exactly $7.50, added once', () => {
  it('otherMaterialCost([{quantity:3, unitCost:2.50}]) = 7.50, and appears exactly once in materialsTotal (not doubled)', () => {
    const line = otherMaterialCost([{ quantity: d('3'), unitCost: d('2.50') }]);
    expect(toMoneyString(line)).toBe('7.50');
    const materials = materialsTotal(d('0'), line, d('0'));
    expect(toMoneyString(materials)).toBe('7.50'); // not 15.00 -- the line is not summed twice
  });
});

describe('COST-018: a direct cost of $100 with overhead ratio 0 is a valid complete calculation -- zero overhead never rejected', () => {
  it('overhead = $0.00, total = $100.00', () => {
    const overhead = overheadAmount(d('100'), d('0'));
    expect(toMoneyString(overhead)).toBe('0.00');
    expect(toMoneyString(estimatedJobCost(d('100'), overhead))).toBe('100.00');
  });
});
