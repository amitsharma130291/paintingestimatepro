// COST-018/COST-019 and CALCULATION_SPEC.md section 1: "Waste >0.5 and
// overhead >0.5 produce nonblocking review warnings." A CalculationResult/
// FieldWarning type already existed in src/engine/types.ts but was entirely
// unused dead scaffolding -- no code path ever populated or surfaced a
// warning anywhere. assembleProjectEstimate now collects real, specific
// warnings on an otherwise-complete result; a high ratio never blocks
// calculation (COST-018/019's "not invalid" requirement), it only informs.
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { createDraftRevision } from '../../src/domain/project';
import type { BusinessSettings, PaintVariant, Surface, EstimateRevision } from '../../src/domain/entities';

function settings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35',
    defaultCoats: 2, defaultWasteRatio: '0.10', wallThroughput: '150', ceilingThroughput: '120',
    trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true,
    createdAt: now, updatedAt: now,
    ...overrides,
  };
}
function variant(id: string, price: string): PaintVariant {
  const now = '2026-01-01T00:00:00.000Z';
  return { id, name: id, color: 'white', sheen: 'eggshell', pricePerGal: price, coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: now, updatedAt: now };
}
function revisionWith(settingsOverrides: Partial<BusinessSettings>, surfaceOverrides: Partial<Surface> = {}): EstimateRevision {
  const ids = sequentialIdSource();
  const snap = createSnapshot(settings(settingsOverrides), [variant('paint-white', '40')], [], ids, 'rev-1');
  const revision = createDraftRevision('project-1', snap, ids);
  const wall: Surface = {
    id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual',
    areaFt2: '400', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
    paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    ...surfaceOverrides,
  };
  return { ...revision, rooms: [], surfaces: [wall] };
}

describe('COST-019: an overhead ratio above 0.5 is valid and produces a nonblocking warning, never an invalid/blocked result', () => {
  it('overheadRatio=1 (100%) still completes with directCost=100 -> overhead=100, total=200, plus a warning', () => {
    const revision = revisionWith({ overheadRatio: '1' }, { areaFt2: '100', wasteRatio: '0' });
    // areaFt2=100, coats=2, wasteRatio=0, coverage=40(pricePerGal irrelevant to cost check)... use a
    // directCost-driving fixture instead: assert on the actual computed directCost/overhead relationship.
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('complete'); // never invalid -- an unusual ratio is not a rejected one
    expect(out.overhead!.toString()).toBe(out.directCost!.toString()); // overhead === directCost at ratio 1
    expect(out.jobCost!.toString()).toBe(out.directCost!.times(2).toString()); // total = directCost*2
    expect(out.warnings.some((w) => /overhead/i.test(w))).toBe(true);
  });

  it('a normal overheadRatio (0.15) produces no overhead warning', () => {
    const revision = revisionWith({ overheadRatio: '0.15' });
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('complete');
    expect(out.warnings.some((w) => /overhead/i.test(w))).toBe(false);
  });

  it('exactly 0.5 (the boundary itself) does not warn -- only strictly above 0.5 does', () => {
    const revision = revisionWith({ overheadRatio: '0.5' });
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.warnings.some((w) => /overhead/i.test(w))).toBe(false);
  });

  it('0.500001 (just above the boundary) does warn', () => {
    const revision = revisionWith({ overheadRatio: '0.500001' });
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.warnings.some((w) => /overhead/i.test(w))).toBe(true);
  });
});

describe('CALCULATION_SPEC section 1: a waste ratio above 0.5 on any surface is valid and produces a nonblocking warning', () => {
  it('a surface with wasteRatio=0.6 completes normally and includes a waste warning naming that surface', () => {
    const revision = revisionWith({}, { wasteRatio: '0.6' });
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('complete');
    expect(out.warnings.some((w) => /waste/i.test(w) && w.includes('wall-1'))).toBe(true);
  });

  it('a normal wasteRatio (0.10) produces no waste warning', () => {
    const revision = revisionWith({}, { wasteRatio: '0.10' });
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.warnings.some((w) => /waste/i.test(w))).toBe(false);
  });
});

describe('An incomplete or invalid result never carries warnings (warnings are only meaningful alongside a real computed value)', () => {
  it('an incomplete revision (no surfaces) reports an empty warnings array, not a stale one', () => {
    const ids = sequentialIdSource();
    const snap = createSnapshot(settings(), [variant('paint-white', '40')], [], ids, 'rev-1');
    const revision = { ...createDraftRevision('project-1', snap, ids), rooms: [], surfaces: [] };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('incomplete');
    expect(out.warnings).toEqual([]);
  });
});
