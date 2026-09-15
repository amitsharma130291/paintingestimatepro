// independent-review R08: assembleServiceHealth is the pure mapping the
// shipped Price Book Health UI never used at all (it hardcoded one
// wall-standard service from catalog[0] with a null price). Expected
// values here are hand-computed from CALCULATION_SPEC.md's own formulas,
// never by re-running the function under test on itself.
import { describe, it, expect } from 'vitest';
import { assembleServiceHealth } from '../../src/domain/serviceHealthAssembly';
import type { BusinessSettings, PaintVariant, ServiceDefinition } from '../../src/domain/entities';

const NOW = '2026-01-01T00:00:00.000Z';
function settings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}
function variant(overrides: Partial<PaintVariant> = {}): PaintVariant {
  return { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '40', coverageFt2PerGal: '400', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW, ...overrides };
}
function wallService(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    id: 'svc-1', name: 'Custom wall service', unit: 'ft2', kind: 'wall', paintVariantId: 'paint-1', coats: 2, wasteRatio: '0',
    loadedHourlyRate: '32', throughput: '160', hoursPerSidePerCoat: null, developedWidthFt: null, widthFt: null, heightFt: null,
    paintedSides: null, additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0', directExpensePerUnit: '0', currentSellingPrice: '1.80',
    createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

describe('assembleServiceHealth', () => {
  it('computes a wall service unit cost matching hand-derived arithmetic', () => {
    // Paint: areaPerUnit(1) * coats(2) * (1+waste(0)) / coverage(400) * price(40) = 0.20
    // Labor: hours = 1*2/160 = 0.0125; cost = 0.0125*32 = 0.40
    // Direct = 0.20 + 0.40 = 0.60; overhead = 0.60*0.15 = 0.09; modeled = 0.69
    const result = assembleServiceHealth(wallService(), [variant()], settings());
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.row.unitCost!.modeledCostPerUnit.toFixed(4)).toBe('0.6900');
  });

  it('reports incomplete when no paint variant is selected', () => {
    const result = assembleServiceHealth(wallService({ paintVariantId: null }), [variant()], settings());
    expect(result.state).toBe('incomplete');
  });

  it('reports incomplete when the referenced paint variant no longer exists in the catalog', () => {
    const result = assembleServiceHealth(wallService({ paintVariantId: 'deleted-variant' }), [variant()], settings());
    expect(result.state).toBe('incomplete');
  });

  it('a missing selling price is a valid state, not an error — the row still computes a required price', () => {
    const result = assembleServiceHealth(wallService({ currentSellingPrice: null }), [variant()], settings());
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.row.price).not.toBeNull();
    expect(result.row.price!.status).not.toBe('atTarget'); // no price entered -> no "at target" claim
  });

  it('a zero selling price is valid (not treated as missing) and retains the real negative profit, per the established zero-price-margin rule (margin undefined only when price is exactly 0)', () => {
    const result = assembleServiceHealth(wallService({ currentSellingPrice: '0' }), [variant()], settings());
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.row.price!.profit?.isNegative()).toBe(true); // a real loss (0 - modeled cost)
    expect(result.row.price!.marginRatio).toBeNull(); // margin is undefined when price=0, matching the actual-vs-baseline rule elsewhere in this codebase
  });

  it('a selling price above modeled cost produces a positive margin; below cost produces a negative one', () => {
    const above = assembleServiceHealth(wallService({ currentSellingPrice: '5.00' }), [variant()], settings());
    const below = assembleServiceHealth(wallService({ currentSellingPrice: '0.10' }), [variant()], settings());
    if (above.state !== 'ok' || below.state !== 'ok') throw new Error('expected ok');
    expect(above.row.price!.marginRatio!.isPositive()).toBe(true);
    expect(below.row.price!.marginRatio!.isNegative()).toBe(true);
  });

  it('falls back to the global settings default throughput/rate when the service has no override', () => {
    const svc = wallService({ throughput: null, loadedHourlyRate: null });
    const result = assembleServiceHealth(svc, [variant()], settings({ wallThroughput: '160', loadedHourlyRate: '32' }));
    expect(result.state).toBe('ok');
  });

  it('reports incomplete when there is no per-service AND no global default throughput', () => {
    const svc = wallService({ throughput: null });
    const result = assembleServiceHealth(svc, [variant()], settings({ wallThroughput: null }));
    expect(result.state).toBe('incomplete');
  });

  it('computes a ceiling service using the ceiling throughput default', () => {
    const svc = wallService({ kind: 'ceiling', throughput: null });
    const result = assembleServiceHealth(svc, [variant()], settings({ ceilingThroughput: '120' }));
    expect(result.state).toBe('ok');
  });

  it('computes a trim service using developedWidthFt as the per-linear-ft area basis', () => {
    // areaPerUnit = developedWidth(0.5) -> paint = 1*0.5*2*(1+0)/400*40 = 0.10
    // hours = 1*2/40(trim throughput) = 0.05; laborCost = 0.05*32=1.60
    // direct = 0.10+1.60=1.70; overhead=1.70*0.15=0.255; modeled=1.955
    const svc: ServiceDefinition = { ...wallService(), kind: 'trim', unit: 'linearFt', developedWidthFt: '0.5', throughput: null };
    const result = assembleServiceHealth(svc, [variant()], settings({ trimThroughput: '40' }));
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.row.unitCost!.modeledCostPerUnit.toFixed(3)).toBe('1.955');
  });

  it('reports incomplete for a trim service missing developedWidthFt', () => {
    const svc: ServiceDefinition = { ...wallService(), kind: 'trim', unit: 'linearFt', developedWidthFt: null };
    const result = assembleServiceHealth(svc, [variant()], settings());
    expect(result.state).toBe('incomplete');
  });

  it('computes a door service using width*height*paintedSides as the per-door area basis', () => {
    // areaPerUnit = 3*7*2 = 42 -> paint = 42*2*(1+0)/400*40 = 8.40
    // hours = doorHours(1,2,2,0.75) = 0.75*1*2*2 = 3; laborCost=3*32=96
    // direct=8.40+96=104.40; overhead=104.40*0.15=15.66; modeled=120.06
    const svc: ServiceDefinition = { ...wallService(), kind: 'door', unit: 'door', widthFt: '3', heightFt: '7', paintedSides: 2, throughput: null, hoursPerSidePerCoat: null };
    const result = assembleServiceHealth(svc, [variant()], settings({ doorHoursPerSidePerCoat: '0.75' }));
    expect(result.state).toBe('ok');
    if (result.state !== 'ok') return;
    expect(result.row.unitCost!.modeledCostPerUnit.toFixed(2)).toBe('120.06');
  });

  it('reports incomplete for a door service missing paintedSides', () => {
    const svc: ServiceDefinition = { ...wallService(), kind: 'door', unit: 'door', widthFt: '3', heightFt: '7', paintedSides: null };
    const result = assembleServiceHealth(svc, [variant()], settings());
    expect(result.state).toBe('incomplete');
  });

  it('rejects an invalid (non-numeric) waste ratio', () => {
    const result = assembleServiceHealth(wallService({ wasteRatio: 'abc' }), [variant()], settings());
    expect(result.state).toBe('invalid');
  });
});
