// CAT-008: "Changing default throughput after customized service created
// -> custom value unchanged; explicit refresh-defaults preview required"
// (DATA_CONTRACT.md, tool-specs/04). assembleServiceHealth ALREADY leaves
// a customized (non-null) field alone forever -- a settings change can
// never silently rewrite it, because there is no snapshot to refresh in
// the first place, only a live-vs-override resolution on every read.
// What was missing is a way to see that a customization has drifted from
// the current default and choose, per field, to resume live tracking.
import { describe, it, expect } from 'vitest';
import { previewServiceDefaultsRefresh, applyServiceDefaultsRefresh } from '../../src/domain/serviceRefresh';
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
function baseService(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    id: 'svc-1', name: 'Custom service', unit: 'ft2', kind: 'wall', paintVariantId: 'paint-1', coats: null, wasteRatio: null,
    loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null, developedWidthFt: null, widthFt: null, heightFt: null,
    paintedSides: null, additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0', directExpensePerUnit: '0', currentSellingPrice: '1.80',
    createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

describe('CAT-008: previewServiceDefaultsRefresh reports only fields the service actually customized', () => {
  it('a service with no customizations at all reports zero field changes', () => {
    const diff = previewServiceDefaultsRefresh(baseService(), [variant()], settings());
    expect(diff.fieldChanges).toEqual([]);
    expect(diff.variantMissing).toBe(false);
  });

  it('wall: a customized throughput that now differs from the live wallThroughput default is reported', () => {
    const service = baseService({ kind: 'wall', throughput: '140' });
    const diff = previewServiceDefaultsRefresh(service, [variant()], settings({ wallThroughput: '160' }));
    expect(diff.fieldChanges).toEqual([{ field: 'throughput', label: 'Production rate', customValue: '140', liveDefaultValue: '160' }]);
  });

  it('ceiling: uses ceilingThroughput as the live default, not wallThroughput', () => {
    const service = baseService({ kind: 'ceiling', throughput: '100' });
    const diff = previewServiceDefaultsRefresh(service, [variant()], settings({ ceilingThroughput: '130' }));
    expect(diff.fieldChanges).toEqual([{ field: 'throughput', label: 'Production rate', customValue: '100', liveDefaultValue: '130' }]);
  });

  it('trim: uses trimThroughput as the live default', () => {
    const service = baseService({ kind: 'trim', throughput: '30', developedWidthFt: '0.5' });
    const diff = previewServiceDefaultsRefresh(service, [variant()], settings({ trimThroughput: '50' }));
    expect(diff.fieldChanges).toEqual([{ field: 'throughput', label: 'Production rate', customValue: '30', liveDefaultValue: '50' }]);
  });

  it('door: uses doorHoursPerSidePerCoat as the live default, and throughput is not applicable to doors at all', () => {
    const service = baseService({ kind: 'door', hoursPerSidePerCoat: '0.5', widthFt: '3', heightFt: '7', paintedSides: 2 });
    const diff = previewServiceDefaultsRefresh(service, [variant()], settings({ doorHoursPerSidePerCoat: '0.9' }));
    expect(diff.fieldChanges).toEqual([{ field: 'hoursPerSidePerCoat', label: 'Hours per side per coat', customValue: '0.5', liveDefaultValue: '0.9' }]);
  });

  it('reports every customized field at once (coats, wasteRatio, loadedHourlyRate, throughput)', () => {
    const service = baseService({ kind: 'wall', coats: 3, wasteRatio: '0.05', loadedHourlyRate: '30', throughput: '140' });
    const diff = previewServiceDefaultsRefresh(service, [variant()], settings({ defaultCoats: 2, defaultWasteRatio: '0.10', loadedHourlyRate: '32', wallThroughput: '160' }));
    expect(diff.fieldChanges.map((c) => c.field).sort()).toEqual(['coats', 'loadedHourlyRate', 'throughput', 'wasteRatio']);
  });

  it('a customized field that HAPPENS to equal the current live default is still reported as customized -- "differs" is not the only trigger, being an explicit override is', () => {
    // Deliberately customized to the SAME value the default currently is;
    // it is still a frozen override that will silently stop tracking the
    // NEXT settings change, unlike a null field -- worth surfacing.
    const service = baseService({ kind: 'wall', throughput: '150' });
    const diff = previewServiceDefaultsRefresh(service, [variant()], settings({ wallThroughput: '150' }));
    expect(diff.fieldChanges).toEqual([{ field: 'throughput', label: 'Production rate', customValue: '150', liveDefaultValue: '150' }]);
  });

  it('geometry fields (developedWidthFt/widthFt/heightFt/paintedSides) are never reported -- no business-level default exists for them', () => {
    const service = baseService({ kind: 'door', hoursPerSidePerCoat: null, widthFt: '3', heightFt: '7', paintedSides: 2 });
    const diff = previewServiceDefaultsRefresh(service, [variant()], settings());
    expect(diff.fieldChanges).toEqual([]);
  });

  it('flags a deleted paint variant (matched by id only, never by display name)', () => {
    const recreatedSameName = variant({ id: 'paint-2', name: 'White', pricePerGal: '55' }); // same name, different id/price -- NOT the same variant
    const service = baseService({ paintVariantId: 'paint-1' });
    const diff = previewServiceDefaultsRefresh(service, [recreatedSameName], settings());
    expect(diff.variantMissing).toBe(true);
  });

  it('no variantMissing flag when the variant id still exists in the catalog', () => {
    const diff = previewServiceDefaultsRefresh(baseService({ paintVariantId: 'paint-1' }), [variant({ id: 'paint-1' })], settings());
    expect(diff.variantMissing).toBe(false);
  });
});

describe('CAT-008: applyServiceDefaultsRefresh reverts ONLY the chosen fields to null, preserving everything else', () => {
  it('reverting the chosen field(s) sets them to null, leaving unrelated fields untouched', () => {
    const service = baseService({ kind: 'wall', coats: 3, wasteRatio: '0.05', throughput: '140', currentSellingPrice: '2.50' });
    const updated = applyServiceDefaultsRefresh(service, new Set(['throughput']));
    expect(updated.throughput).toBeNull();
    expect(updated.coats).toBe(3); // not reverted -- user chose not to
    expect(updated.wasteRatio).toBe('0.05');
    expect(updated.currentSellingPrice).toBe('2.50'); // CAT-008: custom selling price is always preserved
  });

  it('reverting multiple fields at once', () => {
    const service = baseService({ kind: 'wall', coats: 3, wasteRatio: '0.05', loadedHourlyRate: '30', throughput: '140' });
    const updated = applyServiceDefaultsRefresh(service, new Set(['coats', 'wasteRatio', 'loadedHourlyRate', 'throughput']));
    expect(updated.coats).toBeNull();
    expect(updated.wasteRatio).toBeNull();
    expect(updated.loadedHourlyRate).toBeNull();
    expect(updated.throughput).toBeNull();
  });

  it('choosing to revert NO fields leaves the service completely unchanged (Cancel-equivalent)', () => {
    const service = baseService({ kind: 'wall', coats: 3, throughput: '140' });
    const updated = applyServiceDefaultsRefresh(service, new Set());
    expect(updated).toEqual(service);
  });

  it('does not mutate the input service (pure function)', () => {
    const service = baseService({ kind: 'wall', throughput: '140' });
    const serviceCopy = { ...service };
    applyServiceDefaultsRefresh(service, new Set(['throughput']));
    expect(service).toEqual(serviceCopy);
  });

  it('after reverting, the service correctly tracks a FURTHER live settings change (proves it truly resumed live-default resolution, not just a one-time copy)', () => {
    const service = baseService({ kind: 'wall', throughput: '140' });
    const reverted = applyServiceDefaultsRefresh(service, new Set(['throughput']));

    const beforeFurtherChange = assembleServiceHealth(reverted, [variant()], settings({ wallThroughput: '150' }));
    const afterFurtherChange = assembleServiceHealth(reverted, [variant()], settings({ wallThroughput: '200' }));
    expect(beforeFurtherChange.state).toBe('ok');
    expect(afterFurtherChange.state).toBe('ok');
    if (beforeFurtherChange.state !== 'ok' || afterFurtherChange.state !== 'ok') return;
    // A higher throughput means fewer labor hours per unit -> lower modeled cost.
    expect(afterFurtherChange.row.unitCost!.modeledCostPerUnit.lessThan(beforeFurtherChange.row.unitCost!.modeledCostPerUnit)).toBe(true);
  });

  it('the cost/price/margin impact of reverting is independently computable through the real assembleServiceHealth before and after', () => {
    const service = baseService({ kind: 'wall', throughput: '140' }); // slower than the live default -> more labor cost
    const before = assembleServiceHealth(service, [variant()], settings({ wallThroughput: '160' }));
    const reverted = applyServiceDefaultsRefresh(service, new Set(['throughput']));
    const after = assembleServiceHealth(reverted, [variant()], settings({ wallThroughput: '160' }));
    expect(before.state).toBe('ok');
    expect(after.state).toBe('ok');
    if (before.state !== 'ok' || after.state !== 'ok') return;
    // Reverting to the faster live default (160 > 140) must lower modeled cost.
    expect(after.row.unitCost!.modeledCostPerUnit.lessThan(before.row.unitCost!.modeledCostPerUnit)).toBe(true);
  });
});

describe('CAT-008: no automatic refresh happens during ordinary field edits', () => {
  it('assembleServiceHealth never mutates or "fixes" a customized field on its own -- it is a pure read', () => {
    const service = baseService({ kind: 'wall', throughput: '140' });
    const serviceCopy = { ...service };
    assembleServiceHealth(service, [variant()], settings({ wallThroughput: '200' }));
    expect(service).toEqual(serviceCopy); // untouched -- refresh is exclusively the explicit action above, never a side effect of viewing/saving
  });
});
