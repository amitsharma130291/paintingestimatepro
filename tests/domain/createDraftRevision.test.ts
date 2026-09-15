// V5-05/CAT-010: createDraftRevision previously hardcoded
// suppliesAllowance:{mode:'none'} and never inserted a travel expense line,
// regardless of the configured BusinessSettings defaults — a real
// numerical omission from the intended job cost (tool-specs/04: "Travel
// default becomes exactly one new-draft expense line. Supplies allowance
// is one mutually exclusive mode").
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision } from '../../src/domain/project';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import type { BusinessSettings, PaintVariant, Surface } from '../../src/domain/entities';

const NOW = '2026-01-01T00:00:00.000Z';
function settings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}
function variant(): PaintVariant {
  return { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW };
}
function wall(): Surface {
  return { id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual', areaFt2: '400', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null };
}

describe('createDraftRevision: applies configured business defaults, not hardcoded ones', () => {
  it('mode "none" (the factory default) yields no supplies allowance and no travel line, same as before this fix', () => {
    const ids = sequentialIdSource();
    const revision = createDraftRevision('p1', createSnapshot(settings(), [variant()], [], ids, 'c1'), ids);
    expect(revision.suppliesAllowance).toEqual({ mode: 'none', amount: '0', ratio: '0' });
    expect(revision.otherExpenses).toHaveLength(0);
  });

  it('a configured flat $50 supplies default is applied to a new draft and contributes to materials', () => {
    const ids = sequentialIdSource();
    const config = settings({ defaultSuppliesAllowance: { mode: 'flat', amount: '50', ratio: '0' } });
    const revision = { ...createDraftRevision('p1', createSnapshot(config, [variant()], [], ids, 'c1'), ids), surfaces: [wall()] };
    expect(revision.suppliesAllowance).toEqual({ mode: 'flat', amount: '50', ratio: '0' });
    const result = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(result.calculationState).toBe('complete');
    // Paint: ceil(400*2*1.1/350)=3 gallons * $42 = $126; + $50 flat supplies = $176.
    expect(result.materials?.toFixed(2)).toBe('176.00');
  });

  it('a configured paintPercent supplies default (10% of paint cost) is applied and scales off paint cost only', () => {
    const ids = sequentialIdSource();
    const config = settings({ defaultSuppliesAllowance: { mode: 'paintPercent', amount: '0', ratio: '0.10' } });
    const revision = { ...createDraftRevision('p1', createSnapshot(config, [variant()], [], ids, 'c1'), ids), surfaces: [wall()] };
    const result = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(result.calculationState).toBe('complete');
    // Paint $126 * 10% = $12.60 allowance; materials = $126 + $12.60 = $138.60.
    expect(result.materials?.toFixed(2)).toBe('138.60');
  });

  it('a configured $75 travel default inserts exactly ONE expense line, contributing to otherExpenses and overhead', () => {
    const ids = sequentialIdSource();
    const config = settings({ defaultTravelAmount: '75' });
    const revision = { ...createDraftRevision('p1', createSnapshot(config, [variant()], [], ids, 'c1'), ids), surfaces: [wall()] };
    expect(revision.otherExpenses).toHaveLength(1);
    expect(revision.otherExpenses[0].amount).toBe('75');
    expect(revision.otherExpenses[0].description.toLowerCase()).toContain('travel');
    const result = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(result.calculationState).toBe('complete');
    // Independently derived: materials = 3 gal * $42 = $126 (raw 400*2*1.1/350=2.514...->ceil 3).
    // Labor: surface has no own rate/throughput -> falls back to settings'
    // loadedHourlyRate=32, wallThroughput=150. hours=400*2/150=16/3;
    // laborCost=16/3*32=512/3=170.666...
    // directCost = 126 + 512/3 + 75(travel) = 1115/3 = 371.6666... -> $371.67 HALF_UP.
    expect(result.directCost?.toFixed(2)).toBe('371.67');
  });

  it('a zero (factory-default) travel amount never inserts a phantom $0.00 expense line', () => {
    const ids = sequentialIdSource();
    const revision = createDraftRevision('p1', createSnapshot(settings({ defaultTravelAmount: '0' }), [variant()], [], ids, 'c1'), ids);
    expect(revision.otherExpenses).toHaveLength(0);
  });

  it('creating a SECOND draft from the same (unchanged) settings does not duplicate or re-insert a second travel line beyond the one per draft', () => {
    const ids = sequentialIdSource();
    const config = settings({ defaultTravelAmount: '75' });
    const snapshot = createSnapshot(config, [variant()], [], ids, 'c1');
    const draftA = createDraftRevision('p1', snapshot, ids);
    const draftB = createDraftRevision('p2', snapshot, ids);
    expect(draftA.otherExpenses).toHaveLength(1);
    expect(draftB.otherExpenses).toHaveLength(1);
    expect(draftA.otherExpenses).not.toBe(draftB.otherExpenses); // independent arrays, never shared/mutated together
  });
});
