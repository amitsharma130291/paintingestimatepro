// Explicit rate refresh (task item 3 / 4): preview current vs. replacement
// assumptions, detect a catalog variant that was deleted from the live
// catalog and require an explicit retain-or-replace choice, apply only on
// confirm, and never touch a custom price. Written before
// src/domain/rateRefresh.ts exists.
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision } from '../../src/domain/project';
import { previewRateRefresh, applyRateRefresh, undoRateRefresh } from '../../src/domain/rateRefresh';
import type { BusinessSettings, PaintVariant, Surface } from '../../src/domain/entities';

function settings(rate: string): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 's1', loadedHourlyRate: rate, overheadRatio: '0.15', targetMarginRatio: '0.35',
    defaultCoats: 2, defaultWasteRatio: '0.10', wallThroughput: '150', ceilingThroughput: '120',
    trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true,
    createdAt: now, updatedAt: now,
  };
}
function variant(id: string, price: string): PaintVariant {
  const now = '2026-01-01T00:00:00.000Z';
  return { id, name: id, color: 'white', sheen: 'eggshell', pricePerGal: price, coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: now, updatedAt: now };
}
function wallSurface(variantId: string): Surface {
  return {
    id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual',
    areaFt2: '400', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
    paintVariantId: variantId, coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
  };
}

describe('previewRateRefresh', () => {
  it('reports a changed price for a variant the draft actually uses', () => {
    const ids = sequentialIdSource();
    const oldSnap = createSnapshot(settings('32'), [variant('paint-1', '42')], [], ids, 'rev-1');
    let draft = createDraftRevision('p1', oldSnap, ids);
    draft = { ...draft, surfaces: [wallSurface('paint-1')] };

    const liveSnap = createSnapshot(settings('32'), [variant('paint-1', '49')], [], ids, 'rev-2');
    const diff = previewRateRefresh(draft, liveSnap);
    expect(diff.variantChanges).toContainEqual(expect.objectContaining({ variantId: 'paint-1', field: 'pricePerGal', oldValue: '42', newValue: '49' }));
    expect(diff.missingVariantIds).toHaveLength(0);
  });

  it('flags a variant that was deleted from the live catalog but is still referenced by a surface', () => {
    const ids = sequentialIdSource();
    const oldSnap = createSnapshot(settings('32'), [variant('paint-1', '42')], [], ids, 'rev-1');
    let draft = createDraftRevision('p1', oldSnap, ids);
    draft = { ...draft, surfaces: [wallSurface('paint-1')] };

    const liveSnap = createSnapshot(settings('32'), [], [], ids, 'rev-2'); // deleted
    const diff = previewRateRefresh(draft, liveSnap);
    expect(diff.missingVariantIds).toEqual(['paint-1']);
  });
});

describe('applyRateRefresh', () => {
  it('does nothing until applied — preview alone never mutates the draft', () => {
    const ids = sequentialIdSource();
    const oldSnap = createSnapshot(settings('32'), [variant('paint-1', '42')], [], ids, 'rev-1');
    let draft = createDraftRevision('p1', oldSnap, ids);
    draft = { ...draft, surfaces: [wallSurface('paint-1')] };
    const before = JSON.parse(JSON.stringify(draft));
    const liveSnap = createSnapshot(settings('32'), [variant('paint-1', '49')], [], ids, 'rev-2');
    previewRateRefresh(draft, liveSnap);
    expect(draft).toEqual(before);
  });

  it('"retain" keeps a deleted variant usable by copying it forward from the OLD snapshot', () => {
    const ids = sequentialIdSource();
    const oldSnap = createSnapshot(settings('32'), [variant('paint-1', '42')], [], ids, 'rev-1');
    let draft = createDraftRevision('p1', oldSnap, ids);
    draft = { ...draft, surfaces: [wallSurface('paint-1')] };
    const liveSnap = createSnapshot(settings('32'), [], [], ids, 'rev-2');

    const refreshed = applyRateRefresh(draft, liveSnap, [{ variantId: 'paint-1', action: 'retain' }], ids);
    expect(refreshed.activeRateSnapshot.paintVariants.find((v) => v.id === 'paint-1')?.pricePerGal).toBe('42');
    expect(refreshed.surfaces[0].paintVariantId).toBe('paint-1');
    // original draft is untouched (cancel-safe / recoverable)
    expect(draft.activeRateSnapshot).toBe(oldSnap);
  });

  it('"replaceWith" repoints the surface at a new variant and does not need to retain the old one', () => {
    const ids = sequentialIdSource();
    const oldSnap = createSnapshot(settings('32'), [variant('paint-1', '42')], [], ids, 'rev-1');
    let draft = createDraftRevision('p1', oldSnap, ids);
    draft = { ...draft, surfaces: [wallSurface('paint-1')] };
    const liveSnap = createSnapshot(settings('32'), [variant('paint-2', '55')], [], ids, 'rev-2');

    const refreshed = applyRateRefresh(draft, liveSnap, [{ variantId: 'paint-1', action: 'replaceWith', newVariantId: 'paint-2' }], ids);
    expect(refreshed.surfaces[0].paintVariantId).toBe('paint-2');
    expect(refreshed.activeRateSnapshot.paintVariants.find((v) => v.id === 'paint-1')).toBeUndefined();
  });

  it('never touches a custom proposed price', () => {
    const ids = sequentialIdSource();
    const oldSnap = createSnapshot(settings('32'), [variant('paint-1', '42')], [], ids, 'rev-1');
    let draft = createDraftRevision('p1', oldSnap, ids);
    draft = { ...draft, surfaces: [wallSurface('paint-1')], priceMode: 'custom', proposedPrice: '5000' };
    const liveSnap = createSnapshot(settings('32'), [variant('paint-1', '49')], [], ids, 'rev-2');

    const refreshed = applyRateRefresh(draft, liveSnap, [], ids);
    expect(refreshed.proposedPrice).toBe('5000');
    expect(refreshed.priceMode).toBe('custom');
  });

  it('throws rather than silently refreshing an issued revision', () => {
    const ids = sequentialIdSource();
    const oldSnap = createSnapshot(settings('32'), [variant('paint-1', '42')], [], ids, 'rev-1');
    const draft = { ...createDraftRevision('p1', oldSnap, ids), state: 'issued' as const };
    const liveSnap = createSnapshot(settings('32'), [variant('paint-1', '49')], [], ids, 'rev-2');
    expect(() => applyRateRefresh(draft, liveSnap, [], ids)).toThrow();
  });
});

describe('V5-08: preRefreshCheckpoint (DATA_CONTRACT.md #3 durable recovery point)', () => {
  it('applyRateRefresh embeds the exact pre-refresh revision as a checkpoint field on its result', () => {
    const ids = sequentialIdSource();
    const oldSnap = createSnapshot(settings('32'), [variant('paint-1', '42')], [], ids, 'rev-1');
    let draft = createDraftRevision('p1', oldSnap, ids);
    draft = { ...draft, surfaces: [wallSurface('paint-1')], title: 'Before refresh' };
    const liveSnap = createSnapshot(settings('32'), [variant('paint-1', '49')], [], ids, 'rev-2');

    const refreshed = applyRateRefresh(draft, liveSnap, [], ids);
    expect(refreshed.preRefreshCheckpoint?.title).toBe('Before refresh');
    expect(refreshed.preRefreshCheckpoint?.activeRateSnapshot.paintVariants[0].pricePerGal).toBe('42');
    expect(refreshed.activeRateSnapshot.paintVariants[0].pricePerGal).toBe('49');
  });

  it('undoRateRefresh restores the exact pre-refresh revision', () => {
    const ids = sequentialIdSource();
    const oldSnap = createSnapshot(settings('32'), [variant('paint-1', '42')], [], ids, 'rev-1');
    let draft = createDraftRevision('p1', oldSnap, ids);
    draft = { ...draft, surfaces: [wallSurface('paint-1')], title: 'Before refresh' };
    const liveSnap = createSnapshot(settings('32'), [variant('paint-1', '49')], [], ids, 'rev-2');
    const refreshed = applyRateRefresh(draft, liveSnap, [], ids);

    const restored = undoRateRefresh(refreshed);
    expect(restored?.title).toBe('Before refresh');
    expect(restored?.activeRateSnapshot.paintVariants[0].pricePerGal).toBe('42');
  });

  it('returns null when there is no checkpoint to restore', () => {
    const ids = sequentialIdSource();
    const draft = createDraftRevision('p1', createSnapshot(settings('32'), [variant('paint-1', '42')], [], ids, 'rev-1'), ids);
    expect(undoRateRefresh(draft)).toBeNull();
  });

  it('a SECOND refresh replaces the checkpoint rather than nesting it -- only the most recent pre-refresh state is kept', () => {
    const ids = sequentialIdSource();
    const oldSnap = createSnapshot(settings('32'), [variant('paint-1', '42')], [], ids, 'rev-1');
    let draft = createDraftRevision('p1', oldSnap, ids);
    draft = { ...draft, surfaces: [wallSurface('paint-1')], title: 'Original' };
    const midSnap = createSnapshot(settings('32'), [variant('paint-1', '49')], [], ids, 'rev-2');
    const afterFirstRefresh = applyRateRefresh(draft, midSnap, [], ids);

    const laterSnap = createSnapshot(settings('32'), [variant('paint-1', '55')], [], ids, 'rev-3');
    const afterSecondRefresh = applyRateRefresh(afterFirstRefresh, laterSnap, [], ids);

    // The checkpoint reflects the state right before the SECOND refresh (at $49), not the original ($42).
    expect(afterSecondRefresh.preRefreshCheckpoint?.activeRateSnapshot.paintVariants[0].pricePerGal).toBe('49');
    expect(afterSecondRefresh.activeRateSnapshot.paintVariants[0].pricePerGal).toBe('55');
    // No nested chain: the checkpoint itself carries no further checkpoint.
    expect(afterSecondRefresh.preRefreshCheckpoint?.preRefreshCheckpoint).toBeUndefined();
  });
});
