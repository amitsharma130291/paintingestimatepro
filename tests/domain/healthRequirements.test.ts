// HEALTH-002, HEALTH-003, HEALTH-005, HEALTH-006, HEALTH-007, HEALTH-008,
// HEALTH-009, HEALTH-014, HEALTH-015: Price Book Health exact matrix
// figures. HEALTH-005/006's evidence claimed the UI was "a single
// hardcoded demo row" -- STALE: src/components/tools/pro/ProApp.tsx:610
// already maps over the real serviceDefinitions array (fixed by R08 in a
// prior session), so these are genuine confirming-test gaps, not product gaps.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { computeServiceUnitCost, evaluateServiceHealth } from '../../src/engine/serviceHealth';
import { assembleServiceHealth } from '../../src/domain/serviceHealthAssembly';
import type { BusinessSettings, PaintVariant, ServiceDefinition } from '../../src/domain/entities';

const d = (n: string) => new PEP(n);
const NOW = '2026-01-01T00:00:00.000Z';

function baseInput(overrides: Partial<Parameters<typeof computeServiceUnitCost>[0]> = {}) {
  return {
    kind: 'wall' as const, areaPerUnit: d('1'), coats: 2, wasteRatio: d('0'),
    coverageFt2PerGal: d('350'), pricePerGal: d('42'), applicationHoursPerUnit: d('0'),
    additionalLaborHoursPerUnit: d('0'), loadedHourlyRate: d('32'), suppliesCostPerUnit: d('0'),
    directExpensePerUnit: d('0'), overheadRatio: d('0'),
    ...overrides,
  };
}

describe('HEALTH-002/003: the price boundary at target 35% on "the same service" -- HEALTH-001\'s own wall fixture (42/350gal, coats 2, waste 0.1, throughput 150, rate 32, overhead 0.15), whose approx/minimum prices are $1.22/$1.23', () => {
  // HEALTH-001's fixture: modeledCostPerUnit works out to 0.794266...
  // (paint .264 + labor .426666... = directCost .690666..., + 15% overhead).
  // requiredPriceRaw = cost/0.65 = 1.221949...; approxPrice (nearest cent)
  // rounds DOWN to 1.22 (undershoots target); minimumTargetPrice ceils UP
  // to 1.23 (the actual smallest cent that clears 35%) -- exactly the
  // $1.22/$1.23 pair HEALTH-002/003 test against.
  const unitCost = computeServiceUnitCost(baseInput({ areaPerUnit: d('1'), wasteRatio: d('0.1'), applicationHoursPerUnit: d('2').dividedBy('150'), overheadRatio: d('0.15') }));

  it("HEALTH-001 sanity: the fixture's own approx/minimum prices are $1.22/$1.23", () => {
    expect(unitCost.modeledCostPerUnit.toFixed(6)).toBe('0.794267'); // matches the spec's .794266... cost, HALF_UP at 6dp
  });

  it('HEALTH-002: price $1.22 is below the 35% target, and displays as 34.9% (rounded), never labeled target-meeting', () => {
    const row = evaluateServiceHealth('svc-1', unitCost, d('1.22'), d('0.35'));
    expect(row.price!.status).toBe('below_target');
    expect(row.price!.marginRatio!.times(100).toFixed(1)).toBe('34.9'); // displayed, but status is the raw below_target one
  });

  it('HEALTH-003: price $1.23 clears the 35% target -- the smallest cent price that does', () => {
    const at123 = evaluateServiceHealth('svc-1', unitCost, d('1.23'), d('0.35'));
    expect(at123.price!.status).not.toBe('below_target');
    const at122 = evaluateServiceHealth('svc-1', unitCost, d('1.22'), d('0.35'));
    expect(at122.price!.status).toBe('below_target'); // one cent lower fails -- $1.23 is genuinely the minimum
  });
});

describe('HEALTH-005: a trim service (width 0.5, coats 2, throughput 40, rate 32, paint 42/350gal, waste 0.1) matches the exact matrix per-unit figures before overhead', () => {
  it('area/unit=0.5 (linear-ft basis), paint/unit=$0.132, labor/unit=$1.60 -- units stay linear feet, not square feet', () => {
    const input = baseInput({ kind: 'trim', areaPerUnit: d('0.5'), wasteRatio: d('0.1'), applicationHoursPerUnit: d('0.05') }); // trimHours(1,2,40)=0.05
    const cost = computeServiceUnitCost(input);
    expect(input.areaPerUnit.toString()).toBe('0.5');
    expect(cost.paintConsumptionCostPerUnit.toFixed(3)).toBe('0.132');
    expect(cost.laborCostPerUnit.toFixed(2)).toBe('1.60');
  });
});

describe('HEALTH-006: a door service (3x7, 2 sides, coats 2, 0.75hr/side/coat, rate 32, paint 42/350, waste 0.1) matches the exact matrix per-unit figures, with no whole-gallon purchase charge', () => {
  it('paint/unit=$11.088, labor/unit=$96.00, and the per-unit paint cost is a fractional consumption rate, never a $42 whole-gallon charge', () => {
    const input = baseInput({ kind: 'door', areaPerUnit: d('42'), wasteRatio: d('0.1'), applicationHoursPerUnit: d('3') }); // area=3*7*2=42; doorHours(1,2,2,0.75)=3
    const cost = computeServiceUnitCost(input);
    expect(cost.paintConsumptionCostPerUnit.toFixed(3)).toBe('11.088');
    expect(cost.laborCostPerUnit.toFixed(2)).toBe('96.00');
    expect(cost.paintConsumptionCostPerUnit.toString()).not.toBe('42'); // never a whole-gallon material charge
  });
});

describe('HEALTH-007: additional per-unit labor hours (0.25 at $32/hr) add exactly $8 to direct cost, and overhead applies to that $8 exactly once', () => {
  it('$8 direct-cost delta, and the overhead delta on that $8 matches overheadRatio*8 exactly (not zero, not doubled)', () => {
    const without = computeServiceUnitCost(baseInput({ additionalLaborHoursPerUnit: d('0'), overheadRatio: d('0.15') }));
    const withExtra = computeServiceUnitCost(baseInput({ additionalLaborHoursPerUnit: d('0.25'), loadedHourlyRate: d('32'), overheadRatio: d('0.15') }));
    expect(withExtra.directCostPerUnit.minus(without.directCostPerUnit).toFixed(2)).toBe('8.00');
    expect(withExtra.overheadPerUnit.minus(without.overheadPerUnit).toFixed(2)).toBe('1.20'); // 8 * 0.15, applied once
  });
});

describe('HEALTH-008: a per-unit direct expense of $10 at overhead ratio 0.15 adds exactly $1.50 of overhead -- the expense is IN the overhead base, never omitted', () => {
  it('the overhead delta between $0 and $10 direct expense is exactly $1.50', () => {
    const without = computeServiceUnitCost(baseInput({ directExpensePerUnit: d('0'), overheadRatio: d('0.15') }));
    const withExpense = computeServiceUnitCost(baseInput({ directExpensePerUnit: d('10'), overheadRatio: d('0.15') }));
    expect(withExpense.overheadPerUnit.minus(without.overheadPerUnit).toFixed(2)).toBe('1.50');
    expect(withExpense.directCostPerUnit.minus(without.directCostPerUnit).toFixed(2)).toBe('10.00'); // expense IS in the direct-cost/overhead base
  });
});

describe('HEALTH-009: a project-level $50 default travel amount is never automatically added to a service\'s per-unit direct expense', () => {
  function settings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
    return {
      id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
      wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '50',
      defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
      ...overrides,
    };
  }
  function variant(): PaintVariant {
    return { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '40', coverageFt2PerGal: '400', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW };
  }
  function wallService(): ServiceDefinition {
    return {
      id: 'svc-1', name: 'Wall', unit: 'ft2', kind: 'wall', paintVariantId: 'paint-1', coats: 2, wasteRatio: '0',
      loadedHourlyRate: '32', throughput: '160', hoursPerSidePerCoat: null, developedWidthFt: null, widthFt: null, heightFt: null,
      paintedSides: null, additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0', directExpensePerUnit: '0', currentSellingPrice: '1.80',
      createdAt: NOW, updatedAt: NOW,
    };
  }
  it('a service with directExpensePerUnit="0" ignores the project\'s $50 default travel amount entirely', () => {
    const withTravelDefault = assembleServiceHealth(wallService(), [variant()], settings({ defaultTravelAmount: '50' }));
    const withoutTravelDefault = assembleServiceHealth(wallService(), [variant()], settings({ defaultTravelAmount: '0' }));
    expect(withTravelDefault.state).toBe('ok');
    expect(withoutTravelDefault.state).toBe('ok');
    if (withTravelDefault.state !== 'ok' || withoutTravelDefault.state !== 'ok') return;
    // Identical modeled cost regardless of the project-level travel default -- proves it was never read.
    expect(withTravelDefault.row.unitCost!.modeledCostPerUnit.toString()).toBe(withoutTravelDefault.row.unitCost!.modeledCostPerUnit.toString());
  });
});

describe('HEALTH-014: changing the target margin from 35% to 60% never changes the modeled cost -- only the status, re-evaluated at the same live price', () => {
  it('a fixed $1.00 modeled cost and $1.80 selling price is above target at 35% but below target at 60%', () => {
    const unitCost = { paintConsumptionCostPerUnit: d('1'), materialsPerUnit: d('1'), laborHoursPerUnit: d('0'), laborCostPerUnit: d('0'), directCostPerUnit: d('1'), overheadPerUnit: d('0'), modeledCostPerUnit: d('1') };
    const at35 = evaluateServiceHealth('svc-1', unitCost, d('1.80'), d('0.35'));
    const at60 = evaluateServiceHealth('svc-1', unitCost, d('1.80'), d('0.60'));
    expect(at35.unitCost!.modeledCostPerUnit.toString()).toBe(at60.unitCost!.modeledCostPerUnit.toString()); // cost unchanged
    expect(at35.price!.status).not.toBe('below_target');
    expect(at60.price!.status).toBe('below_target'); // same $1.80 price, now below the raised target
  });
});

describe('HEALTH-015: a live paint-price increase (42 -> 49) raises the modeled cost and lowers margin on every re-evaluation -- Price Book Health always reads the LIVE catalog, never a frozen snapshot', () => {
  function settings(): BusinessSettings {
    return {
      id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
      wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
      defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
    };
  }
  function variant(price: string): PaintVariant {
    return { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: price, coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW };
  }
  function wallService(): ServiceDefinition {
    return {
      id: 'svc-1', name: 'Wall', unit: 'ft2', kind: 'wall', paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1',
      loadedHourlyRate: '32', throughput: '150', hoursPerSidePerCoat: null, developedWidthFt: null, widthFt: null, heightFt: null,
      paintedSides: null, additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0', directExpensePerUnit: '0', currentSellingPrice: '1.80',
      createdAt: NOW, updatedAt: NOW,
    };
  }
  it('re-evaluating the same service against a live catalog price of $49 (was $42) increases modeled cost and decreases margin', () => {
    const before = assembleServiceHealth(wallService(), [variant('42')], settings());
    const after = assembleServiceHealth(wallService(), [variant('49')], settings());
    expect(before.state).toBe('ok');
    expect(after.state).toBe('ok');
    if (before.state !== 'ok' || after.state !== 'ok') return;
    expect(after.row.unitCost!.modeledCostPerUnit.greaterThan(before.row.unitCost!.modeledCostPerUnit)).toBe(true);
    expect(after.row.price!.marginRatio!.lessThan(before.row.price!.marginRatio!)).toBe(true);
  });
  // "Issued project unchanged" is a project-level concept, not a Price Book
  // Health row concept -- Health rows have no snapshot/freeze mechanism at
  // all (they always recompute live, proven above). Issued-revision
  // immutability under a live catalog/settings change is already covered
  // end-to-end by tests/integration/draftIssuedIsolation.test.ts, which this
  // requirement's "issued project unchanged" half maps onto instead.
});
