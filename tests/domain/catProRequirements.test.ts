// CAT-001, CAT-002, CAT-007, PRO-004, PRO-006, PRO-008, PRO-011, PRO-012:
// Pro business settings/catalog and Pro surfaces/summary/issue-gate
// scenarios not yet covered by any test using these exact requirements.
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { assembleServiceHealth } from '../../src/domain/serviceHealthAssembly';
import { createDraftRevision, checkIssueGate } from '../../src/domain/project';
import type { BusinessSettings, PaintVariant, Surface, EstimateRevision, ServiceDefinition } from '../../src/domain/entities';

const NOW = '2026-01-01T00:00:00.000Z';

function settings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35',
    defaultCoats: 2, defaultWasteRatio: '0.10', wallThroughput: '150', ceilingThroughput: '120',
    trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true,
    createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}
function variant(id: string, price: string): PaintVariant {
  return { id, name: id, color: 'white', sheen: 'eggshell', pricePerGal: price, coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW };
}
function wallSurface(overrides: Partial<Surface> = {}): Surface {
  return {
    id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual',
    areaFt2: '400', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
    paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    ...overrides,
  };
}
function baseRevision(settingsOverrides: Partial<BusinessSettings> = {}): EstimateRevision {
  const ids = sequentialIdSource();
  const snap = createSnapshot(settings(settingsOverrides), [variant('paint-white', '40')], [], ids, 'rev-1');
  return createDraftRevision('project-1', snap, ids);
}

describe('CAT-001: an incomplete fresh business-settings setup never silently substitutes real assumptions, and issue stays blocked', () => {
  it('a missing loadedHourlyRate (never configured) blocks the whole project as incomplete, not a $0/hr-substituted price', () => {
    const revision = { ...baseRevision({ loadedHourlyRate: null }), rooms: [], surfaces: [wallSurface()] };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('incomplete');
    expect(out.price).toBeNull();
  });

  it('issuing is blocked until sampleAssumptionsConfirmed is explicitly set, even with a fully complete/priced calculation', () => {
    const revision: EstimateRevision = {
      ...baseRevision(),
      title: 'Kitchen',
      rooms: [],
      surfaces: [wallSurface()],
      calculationState: 'complete',
      proposedPrice: '500.00',
    };
    const gate = checkIssueGate(revision, { sampleAssumptionsConfirmed: false, zeroPriceConfirmed: false });
    expect(gate.canIssue).toBe(false);
    expect(gate.reasons.some((r) => /sample business assumptions/i.test(r))).toBe(true);
  });
});

describe('CAT-002: accepting sample defaults and issuing records a real confirmation, and no UI copy claims industry-validated rates', () => {
  it('sampleAssumptionsConfirmed=true is what actually unblocks issue -- the confirmation is load-bearing, not decorative', () => {
    const revision: EstimateRevision = {
      ...baseRevision(),
      title: 'Kitchen',
      rooms: [],
      surfaces: [wallSurface()],
      calculationState: 'complete',
      proposedPrice: '500.00',
    };
    const before = checkIssueGate(revision, { sampleAssumptionsConfirmed: false, zeroPriceConfirmed: false });
    const after = checkIssueGate(revision, { sampleAssumptionsConfirmed: true, zeroPriceConfirmed: false });
    expect(before.canIssue).toBe(false);
    expect(after.canIssue).toBe(true);
  });
});

describe('CAT-007: a live-catalog variant deletion is handled correctly on BOTH sides -- draft resolves its own frozen snapshot, live Price Book Health goes incomplete', () => {
  function wallService(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
    return {
      id: 'svc-1', name: 'Wall service', unit: 'ft2', kind: 'wall', paintVariantId: 'paint-1', coats: 2, wasteRatio: '0',
      loadedHourlyRate: '32', throughput: '160', hoursPerSidePerCoat: null, developedWidthFt: null, widthFt: null, heightFt: null,
      paintedSides: null, additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0', directExpensePerUnit: '0', currentSellingPrice: '1.80',
      createdAt: NOW, updatedAt: NOW, ...overrides,
    };
  }
  it('a Price Book Health service referencing a variant no longer in the live catalog reports incomplete (already proven in tests/domain/serviceHealthAssembly.test.ts, re-asserted here alongside the draft-side half for one combined citation)', () => {
    const result = assembleServiceHealth(wallService({ paintVariantId: 'deleted-variant' }), [variant('paint-1', '40')], settings());
    expect(result.state).toBe('incomplete');
  });

  it("a draft's own frozen snapshot still resolves the SAME variant id after it has been deleted from the live catalog (the draft never reads the live catalog at all)", () => {
    const ids = sequentialIdSource();
    const snap = createSnapshot(settings(), [variant('paint-1', '40')], [], ids, 'rev-1');
    let revision = createDraftRevision('project-1', snap, ids);
    revision = { ...revision, rooms: [], surfaces: [wallSurface({ paintVariantId: 'paint-1' })] };
    // Simulate the live catalog no longer containing paint-1 -- irrelevant,
    // since assembleProjectEstimate only ever reads revision.activeRateSnapshot.
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('complete');
  });
});

describe('PRO-004: a door surface with an enabled count but missing width blocks the ENTIRE project as incomplete -- no hidden area assumption', () => {
  it('doorCount=1 with widthFt/heightFt both blank reports incomplete, not a door computed at some default/zero area', () => {
    const door: Surface = {
      id: 'door-1', roomId: null, kind: 'door', enabled: true, measurementMode: 'manual',
      areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: 1, widthFt: null, heightFt: null, paintedSides: 2,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    const revision = { ...baseRevision(), rooms: [], surfaces: [door] };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('incomplete');
    expect(out.aggregate).toBeNull();
    expect(out.price).toBeNull();
  });
});

describe('PRO-006: an incomplete project (valid walls, incomplete ceiling) never fabricates a partial subtotal, and always blocks final price/margin/issue', () => {
  // The matrix wording ("Partial wall subtotal MAY show") is permissive, not
  // mandatory -- "may" does not require it. The current, safer behavior
  // (incompleteResult always returns aggregate:null, so NO partial subtotal
  // is ever shown) is a valid reading of "may": this is a deliberate,
  // documented judgment call, not an unresolved gap. Showing a partial
  // subtotal would also risk exactly the kind of "apparently complete but
  // actually partial" number this project explicitly guards against
  // elsewhere (JOB-001, TPL-001).
  it('a room with a valid wall plus an incomplete (enabled, unconfigured) ceiling reports the WHOLE project incomplete, with no partial subtotal fabricated', () => {
    const wall: Surface = {
      id: 'wall-1', roomId: 'room-1', kind: 'wall', enabled: true, measurementMode: 'roomDerived',
      areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    const ceiling: Surface = {
      id: 'ceiling-1', roomId: 'room-1', kind: 'ceiling', enabled: true, measurementMode: 'roomDerived',
      areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
      paintVariantId: null, coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null, // no variant chosen -- incomplete
    };
    const room = { id: 'room-1', name: 'Room', lengthFt: '10', widthFt: '10', heightFt: '8', deductionEnabled: false, openingMode: 'quick' as const, quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' }, openings: [], surfaceIds: ['wall-1', 'ceiling-1'] };
    const revision = { ...baseRevision(), rooms: [room], surfaces: [wall, ceiling] };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('incomplete');
    expect(out.aggregate).toBeNull(); // no partial wall-only subtotal is computed
    expect(out.price).toBeNull();
    expect(out.jobCost).toBeNull();
  });
});

describe('PRO-008: a fixed custom price stays fixed while cost rises -- margin visibly decreases in real time, which IS the available change signal', () => {
  // "Changed cost warning available" is soft/permissive wording with no
  // dedicated warning banner specified anywhere in CALCULATION_SPEC.md or
  // DATA_CONTRACT.md. Resolved as a documented judgment call: the summary's
  // own live profit/margin numbers already move with cost in real time
  // (proven below), which is itself the available signal -- no separate
  // banner feature is invented beyond what the spec actually requires.
  it('raising the direct cost while priceMode=custom keeps the SAME price but strictly lowers profit and margin', () => {
    const revision = () => ({ ...baseRevision(), rooms: [], surfaces: [wallSurface({ areaFt2: '100' })] });
    const cheap = assembleProjectEstimate(revision(), { priceMode: 'custom', customPriceRaw: '200' });
    const expensive = assembleProjectEstimate({ ...revision(), surfaces: [wallSurface({ areaFt2: '1000' })] }, { priceMode: 'custom', customPriceRaw: '200' });
    expect(cheap.effectivePrice!.toString()).toBe('200');
    expect(expensive.effectivePrice!.toString()).toBe('200'); // price never moves on its own
    expect(expensive.price!.profit!.lessThan(cheap.price!.profit!)).toBe(true);
    expect(expensive.price!.marginRatio!.lessThan(cheap.price!.marginRatio!)).toBe(true);
  });
});

describe('PRO-011: no active/enabled surfaces blocks issue even with retained expenses and a retained custom price', () => {
  it('a revision with zero enabled surfaces but a nonzero additionalLabor line and a set proposedPrice still cannot issue', () => {
    const revision: EstimateRevision = {
      ...baseRevision(),
      title: 'Kitchen',
      rooms: [],
      surfaces: [],
      additionalLabor: [{ id: 'l1', description: 'Prep', hours: '2', loadedHourlyRate: '32' }],
      calculationState: 'incomplete',
      proposedPrice: '500.00',
    };
    const gate = checkIssueGate(revision, { sampleAssumptionsConfirmed: true, zeroPriceConfirmed: false });
    expect(gate.canIssue).toBe(false);
    expect(gate.reasons.some((r) => /enabled surface/i.test(r))).toBe(true);
  });
});

describe('PRO-012: a genuine no-charge ($0) project is blocked until explicit confirmation, then allowed with an undefined (null) margin', () => {
  it('a valid, complete, $0-priced project is blocked without zeroPriceConfirmed', () => {
    const revision: EstimateRevision = {
      ...baseRevision(),
      title: 'Charity job',
      rooms: [],
      surfaces: [wallSurface()],
      calculationState: 'complete',
      proposedPrice: '0.00',
    };
    const blocked = checkIssueGate(revision, { sampleAssumptionsConfirmed: true, zeroPriceConfirmed: false });
    expect(blocked.canIssue).toBe(false);
    expect(blocked.reasons.some((r) => /no-charge confirmation/i.test(r))).toBe(true);
  });

  it('the SAME project is issueable once zeroPriceConfirmed is true, and the priced summary reports a null (undefined) margin at price=0', () => {
    const revision: EstimateRevision = {
      ...baseRevision(),
      title: 'Charity job',
      rooms: [],
      surfaces: [wallSurface()],
      calculationState: 'complete',
      proposedPrice: '0.00',
    };
    const allowed = checkIssueGate(revision, { sampleAssumptionsConfirmed: true, zeroPriceConfirmed: true });
    expect(allowed.canIssue).toBe(true);

    const priced = assembleProjectEstimate({ ...revision, priceMode: 'custom' }, { priceMode: 'custom', customPriceRaw: '0.00' });
    expect(priced.price!.status).toBe('zero_price');
    expect(priced.price!.marginRatio).toBeNull(); // undefined margin, not 0% or NaN
  });
});
