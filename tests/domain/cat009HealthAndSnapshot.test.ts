// CAT-009 (tool-specs/04; DATA_CONTRACT.md #1): "GIVEN Change current
// overhead or margin target WHEN View health and old estimate THEN
// Health refreshes; saved estimate retains snapshot values." This was
// previously marked 'verified' on an INFERRED basis only (no test
// actually changed settings.overheadRatio/targetMarginRatio and
// re-inspected an existing revision) -- this file closes that gap with
// one dedicated, executable test per clause of the requirement:
//   1. changing live overhead/target updates Price Book Health
//      (assembleServiceHealth reads settings fresh on every call -- no
//      caching layer to accidentally serve a stale row);
//   2. an existing saved estimate (a draft revision created before the
//      change) keeps computing off its OWN captured
//      activeRateSnapshot.businessSettings, never the live object;
//   3. a brand-new estimate created AFTER the change captures the new
//      settings in its own fresh snapshot.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { assembleServiceHealth } from '../../src/domain/serviceHealthAssembly';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { createDraftRevision } from '../../src/domain/project';
import type { BusinessSettings, PaintVariant, ServiceDefinition, Surface, EstimateRevision } from '../../src/domain/entities';

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
function variant(overrides: Partial<PaintVariant> = {}): PaintVariant {
  return { id: 'paint-white', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '40', coverageFt2PerGal: '400', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW, ...overrides };
}
function wallService(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    id: 'svc-1', name: 'Standard wall', unit: 'ft2', kind: 'wall', paintVariantId: 'paint-white', coats: 2, wasteRatio: '0',
    loadedHourlyRate: '32', throughput: '160', hoursPerSidePerCoat: null, developedWidthFt: null, widthFt: null, heightFt: null,
    paintedSides: null, additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0', directExpensePerUnit: '0', currentSellingPrice: '1.80',
    createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}
function wallSurface(overrides: Partial<Surface> = {}): Surface {
  return {
    id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual',
    areaFt2: '400', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
    paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    ...overrides,
  };
}
function draftAt(theseSettings: BusinessSettings): EstimateRevision {
  const ids = sequentialIdSource();
  const snap = createSnapshot(theseSettings, [variant()], [], ids, 'rev-1');
  return { ...createDraftRevision('project-1', snap, ids), surfaces: [wallSurface()] };
}

describe('CAT-009: live settings changes reach Price Book Health; a saved estimate keeps its own captured rates; a new estimate picks up the change', () => {
  it('clause 1 -- changing live overhead and target margin updates Price Book Health for the SAME service, with hand-derived numbers', () => {
    const settingsBefore = settings({ overheadRatio: '0.15', targetMarginRatio: '0.35' });
    const before = assembleServiceHealth(wallService(), [variant()], settingsBefore);
    expect(before.state).toBe('ok');
    if (before.state !== 'ok') return;
    // Paint: 1*2*(1+0)/400*40 = 0.20; Labor: 1*2/160=0.0125h*32=0.40; direct=0.60
    // overhead = 0.60*0.15 = 0.09 -> modeled = 0.69
    // minimumTargetPrice = ceil-to-cent(cost/(1-target)) = ceil-to-cent(0.69/0.65 = 1.0615...) = 1.07
    expect(before.row.unitCost!.modeledCostPerUnit.toFixed(4)).toBe('0.6900');
    expect(before.row.price!.minimumTargetPrice!.toFixed(4)).toBe('1.0700');

    // The user changes overhead and target margin in Business settings.
    // No draft/estimate is touched -- this is purely "the live settings
    // object the Pro app holds changed." Health must reflect it on the
    // very next read, with no separate refresh/cache-bust step.
    const settingsAfter = settings({ overheadRatio: '0.30', targetMarginRatio: '0.50' });
    const after = assembleServiceHealth(wallService(), [variant()], settingsAfter);
    expect(after.state).toBe('ok');
    if (after.state !== 'ok') return;
    // overhead = 0.60*0.30 = 0.18 -> modeled = 0.78
    expect(after.row.unitCost!.modeledCostPerUnit.toFixed(4)).toBe('0.7800');
    expect(after.row.price!.minimumTargetPrice!.toFixed(4)).toBe((0.78 / 0.50).toFixed(4));

    // Both the cost floor and the required price genuinely moved --
    // this is not a no-op change being rubber-stamped as "refreshed."
    expect(after.row.unitCost!.modeledCostPerUnit.greaterThan(before.row.unitCost!.modeledCostPerUnit)).toBe(true);
    expect(after.row.price!.minimumTargetPrice!.greaterThan(before.row.price!.minimumTargetPrice!)).toBe(true);
  });

  it('clause 2 -- an existing saved estimate (draft created before the change) still computes off its OWN captured overhead/target after the live settings change', () => {
    const settingsAtDraftTime = settings({ overheadRatio: '0.15', targetMarginRatio: '0.35' });
    const existingDraft = draftAt(settingsAtDraftTime);

    expect(existingDraft.activeRateSnapshot.businessSettings.overheadRatio).toBe('0.15');
    expect(existingDraft.activeRateSnapshot.businessSettings.targetMarginRatio).toBe('0.35');

    const before = assembleProjectEstimate(existingDraft, { priceMode: 'suggested', customPriceRaw: '' });
    expect(before.calculationState).toBe('complete');
    // CALCULATION_SPEC.md / src/engine/cost.ts: "overhead = directCost *
    // overheadRatio" -- an independent cross-check against the engine's
    // own documented formula (not a re-run of the function under test
    // agreeing with itself), using the snapshot's own captured ratio.
    expect(before.overhead!.toFixed(6)).toBe(before.directCost!.times('0.15').toFixed(6));
    expect(before.jobCost!.toFixed(6)).toBe(before.directCost!.plus(before.overhead!).toFixed(6));

    // The live BusinessSettings object changes AFTER this draft exists
    // (simulated the same way ProApp's own live `settings` state would
    // change -- a brand-new object, never mutating the one already
    // captured inside existingDraft.activeRateSnapshot).
    const settingsAfterChange = settings({ overheadRatio: '0.30', targetMarginRatio: '0.50' });
    expect(settingsAfterChange).not.toBe(existingDraft.activeRateSnapshot.businessSettings);

    // Recalculating the SAME existing draft (exactly what reopening it
    // in the Pro app does) must reproduce the identical numbers -- the
    // revision's own assembleProjectEstimate call never takes live
    // settings as an argument, so there is no path for the change above
    // to reach it.
    const after = assembleProjectEstimate(existingDraft, { priceMode: 'suggested', customPriceRaw: '' });
    expect(after.directCost!.equals(before.directCost!)).toBe(true);
    expect(after.overhead!.equals(before.overhead!)).toBe(true);
    expect(after.jobCost!.equals(before.jobCost!)).toBe(true);
    expect(existingDraft.activeRateSnapshot.businessSettings.overheadRatio).toBe('0.15');
    expect(existingDraft.activeRateSnapshot.businessSettings.targetMarginRatio).toBe('0.35');
  });

  it('clause 3 -- a newly created estimate, made after the settings change, captures the NEW overhead/target in its own snapshot', () => {
    const settingsAfterChange = settings({ overheadRatio: '0.30', targetMarginRatio: '0.50' });
    const newDraft = draftAt(settingsAfterChange);

    expect(newDraft.activeRateSnapshot.businessSettings.overheadRatio).toBe('0.30');
    expect(newDraft.activeRateSnapshot.businessSettings.targetMarginRatio).toBe('0.50');

    const result = assembleProjectEstimate(newDraft, { priceMode: 'suggested', customPriceRaw: '' });
    expect(result.calculationState).toBe('complete');
    // Same surfaces/rate inputs as clause 2's draft, so the same direct
    // cost -- but overhead must reflect the NEW 0.30 ratio, independently
    // cross-checked against the engine's documented formula.
    expect(result.overhead!.toFixed(6)).toBe(result.directCost!.times('0.30').toFixed(6));
    expect(result.jobCost!.toFixed(6)).toBe(result.directCost!.plus(result.overhead!).toFixed(6));
  });

  it('end-to-end: an old estimate and a new estimate coexist with genuinely different frozen rates after one live settings change, and Price Book Health reflects only the live value at read time', () => {
    const ids = sequentialIdSource();
    const settingsV1 = settings({ overheadRatio: '0.15', targetMarginRatio: '0.35' });
    const snapV1 = createSnapshot(settingsV1, [variant()], [], ids, 'rev-1');
    const oldDraft = { ...createDraftRevision('project-1', snapV1, ids), surfaces: [wallSurface()] };

    // Live settings change.
    const settingsV2 = settings({ overheadRatio: '0.30', targetMarginRatio: '0.50' });

    // A new estimate created after the change.
    const snapV2 = createSnapshot(settingsV2, [variant()], [], ids, 'rev-2');
    const newDraft = { ...createDraftRevision('project-2', snapV2, ids), surfaces: [wallSurface()] };

    const oldResult = assembleProjectEstimate(oldDraft, { priceMode: 'suggested', customPriceRaw: '' });
    const newResult = assembleProjectEstimate(newDraft, { priceMode: 'suggested', customPriceRaw: '' });
    // Same surfaces/catalog/rate inputs on both drafts -> identical direct
    // cost; only the captured overheadRatio differs (0.15 vs 0.30), and
    // the resulting overhead must scale by exactly that ratio -- an
    // independent check, not the function agreeing with itself.
    expect(oldResult.directCost!.equals(newResult.directCost!)).toBe(true);
    expect(oldResult.overhead!.toFixed(6)).toBe(oldResult.directCost!.times('0.15').toFixed(6));
    expect(newResult.overhead!.toFixed(6)).toBe(newResult.directCost!.times('0.30').toFixed(6));
    expect(oldResult.overhead!.equals(newResult.overhead!)).toBe(false);

    // Price Book Health, read against the CURRENT live settings (V2),
    // reflects V2 regardless of which draft happens to exist.
    const health = assembleServiceHealth(wallService(), [variant()], settingsV2);
    expect(health.state).toBe('ok');
    if (health.state !== 'ok') return;
    expect(health.row.unitCost!.modeledCostPerUnit.toFixed(4)).toBe('0.7800');

    // Sanity: the health assembly never received or referenced either
    // draft's frozen snapshot -- it is fed the live settings object only.
    expect(new PEP(oldDraft.activeRateSnapshot.businessSettings.overheadRatio).equals(new PEP('0.15'))).toBe(true);
  });
});
