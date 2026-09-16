// Numerical-hardening initiative, Part 18: explicit state-transition
// coverage. Each test below walks one of the required transition sequences
// end-to-end through the REAL production domain functions (never a
// duplicated/simulated state machine), asserting the state at every step,
// not just the final one. Several of these sequences already have partial
// coverage elsewhere (tests/domain/lifecycle.test.ts, rateRefresh.test.ts,
// backup.test.ts, tests/engine/actuals.test.ts) -- this file's job is to
// assert the FULL chain in one continuous run per sequence, catching any
// gap between two individually-tested steps.
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import {
  createDraftRevision,
  checkIssueGate,
  issueRevision,
  createDraftFromIssued,
  supersede,
  upsertRevision,
} from '../../src/domain/project';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { buildCustomerDocument } from '../../src/domain/customerDocument';
import { previewRateRefresh, applyRateRefresh, undoRateRefresh } from '../../src/domain/rateRefresh';
import { exportBackup, planImportAsCopies, validateBackupEnvelope, planFullRestoreMerge } from '../../src/domain/backup';
import { evaluateActualReview } from '../../src/engine/actuals';
import { PEP } from '../../src/engine/decimal';
import type { BusinessSettings, PaintVariant, EstimateRevision, Room, Surface, Project } from '../../src/domain/entities';

function makeSettings(rate = '32'): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'settings-1', loadedHourlyRate: rate, overheadRatio: '0.15', targetMarginRatio: '0.35',
    defaultCoats: 2, defaultWasteRatio: '0.10', wallThroughput: '150', ceilingThroughput: '120',
    trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true,
    createdAt: now, updatedAt: now,
  };
}
function makeVariant(price = '40'): PaintVariant {
  const now = '2026-01-01T00:00:00.000Z';
  return { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: price, coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: now, updatedAt: now };
}
function withWallSurface(revision: EstimateRevision, areaFt2: string | null): EstimateRevision {
  const room: Room = {
    id: 'room-1', name: 'Living Room', lengthFt: null, widthFt: null, heightFt: null,
    deductionEnabled: false, openingMode: 'quick',
    quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' },
    openings: [], surfaceIds: ['surface-1'],
  };
  const surface: Surface = {
    id: 'surface-1', roomId: 'room-1', kind: 'wall', enabled: true, measurementMode: 'manual',
    areaFt2, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null,
    paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.10',
    loadedHourlyRate: '32', throughput: '150', hoursPerSidePerCoat: null,
  };
  return { ...revision, rooms: [room], surfaces: [surface] };
}

describe('State transition: blank -> incomplete -> complete -> invalid -> complete', () => {
  it('walks the full calculation-state cycle through the real assembly pipeline at every step', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(makeSettings(), [makeVariant()], [], ids, 'rev-1');
    let revision = createDraftRevision('project-1', snapshot, ids);

    // 1. blank: no surfaces at all yet.
    let result = assembleProjectEstimate(revision, { priceMode: 'custom', customPriceRaw: '' });
    expect(result.calculationState).toBe('incomplete');

    // 2. incomplete: a surface exists but its area is missing.
    revision = withWallSurface(revision, null);
    result = assembleProjectEstimate(revision, { priceMode: 'custom', customPriceRaw: '' });
    expect(result.calculationState).toBe('incomplete');

    // 3. complete: area filled in.
    revision = withWallSurface(revision, '300');
    result = assembleProjectEstimate(revision, { priceMode: 'custom', customPriceRaw: '5000' });
    expect(result.calculationState).toBe('complete');
    expect(result.jobCost).not.toBeNull();

    // 4. invalid: force an opening deduction larger than the gross area by
    // switching the same room into a geometrically-impossible state.
    revision = {
      ...revision,
      rooms: [{ ...revision.rooms[0], deductionEnabled: true, quick: { doorCount: 100, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' } }],
      surfaces: [{ ...revision.surfaces[0], measurementMode: 'roomDerived' as const, lengthFt: null }],
    };
    // give the room real dimensions so gross area is computable, but small
    // enough that 100 quick doors (2000 ft2) exceeds it.
    revision = { ...revision, rooms: [{ ...revision.rooms[0], lengthFt: '10', widthFt: '10', heightFt: '8' }] };
    result = assembleProjectEstimate(revision, { priceMode: 'custom', customPriceRaw: '5000' });
    expect(result.calculationState).toBe('invalid');

    // 5. complete again: fix the opening count back down.
    revision = { ...revision, rooms: [{ ...revision.rooms[0], quick: { doorCount: 1, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' } }] };
    result = assembleProjectEstimate(revision, { priceMode: 'custom', customPriceRaw: '5000' });
    expect(result.calculationState).toBe('complete');
  });
});

describe('State transition: draft -> saved -> reopened -> refreshed -> undone -> issued', () => {
  it('walks the full revision lifecycle, asserting numeric state at every step', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(makeSettings('32'), [makeVariant('40')], [], ids, 'rev-1');
    let draft = createDraftRevision('project-1', snapshot, ids);
    draft = withWallSurface(draft, '300');
    draft = { ...draft, title: 'Test project', proposedPrice: '5000' };

    // draft
    let result = assembleProjectEstimate(draft, { priceMode: 'custom', customPriceRaw: '5000' });
    expect(draft.state).toBe('draft');
    expect(result.calculationState).toBe('complete');
    const jobCostAtDraft = result.jobCost!.toFixed(2);

    // saved -> reopened (simulated by round-tripping through a Project container)
    let project: Project = {
      id: 'project-1', title: 'Test project', revisions: [draft], activeRevisionId: draft.id,
      actualReviews: [], createdAt: ids.now(), updatedAt: ids.now(), version: 1,
    };
    project = upsertRevision(project, draft);
    const reopened = project.revisions[0];
    result = assembleProjectEstimate(reopened, { priceMode: 'custom', customPriceRaw: '5000' });
    expect(result.jobCost!.toFixed(2)).toBe(jobCostAtDraft);

    // refreshed: live paint price changes. (The surface's own loadedHourlyRate
    // is an explicit per-surface override, not derived from business
    // settings, so changing settings.loadedHourlyRate alone would not
    // actually flow through here -- the paint variant price, referenced by
    // paintVariantId, is what a real rate refresh meaningfully changes for
    // this fixture shape.)
    const liveVariant = { ...snapshot.paintVariants[0], pricePerGal: '55', updatedAt: ids.now() };
    const liveSnapshot = createSnapshot(snapshot.businessSettings, [liveVariant], [], ids, 'rev-2');
    const diff = previewRateRefresh(reopened, liveSnapshot);
    expect(diff.missingVariantIds).toHaveLength(0);
    const refreshed = applyRateRefresh(reopened, liveSnapshot, [], ids);
    expect(refreshed.preRefreshCheckpoint).not.toBeNull();
    expect(refreshed.preRefreshCheckpoint!.id).toBe(refreshed.id);
    const refreshedResult = assembleProjectEstimate(refreshed, { priceMode: 'custom', customPriceRaw: '5000' });
    expect(refreshedResult.jobCost!.toFixed(2)).not.toBe(jobCostAtDraft); // rate genuinely changed

    // undone: restores the exact pre-refresh numeric state.
    const undoneRaw = undoRateRefresh(refreshed);
    expect(undoneRaw).not.toBeNull();
    const undoneResult = assembleProjectEstimate(undoneRaw!, { priceMode: 'custom', customPriceRaw: '5000' });
    expect(undoneResult.jobCost!.toFixed(2)).toBe(jobCostAtDraft);
    // Mirrors what the real UI layer does after every edit/recompute: persist
    // the freshly-assembled calculationState back onto the revision.
    // checkIssueGate reads this STORED field, not a live recomputation.
    const undone = { ...undoneRaw!, calculationState: undoneResult.calculationState };

    // issued: freezes the (undone, pre-refresh-rate) numeric state.
    const gate = checkIssueGate(undone, { sampleAssumptionsConfirmed: true, zeroPriceConfirmed: false });
    expect(gate.reasons).toEqual([]);
    expect(gate.canIssue).toBe(true);
    const issued = issueRevision(undone, (r) => buildCustomerDocument(r, { estimateNumber: 'E-1', estimateDate: '2026-01-01', projectAddress: '', revisionLabel: 'Rev 1' }), ids);
    expect(issued.state).toBe('issued');
    expect(issued.customerDocumentSnapshot).not.toBeNull();
    expect(issued.customerDocumentSnapshot!.proposedPrice).toBe('5000');
  });
});

describe('State transition: issued -> new draft -> changed -> issued -> prior superseded', () => {
  it('walks the revision-supersession lifecycle, confirming the prior issued revision is never mutated', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(makeSettings(), [makeVariant()], [], ids, 'rev-1');
    let draft = createDraftRevision('project-1', snapshot, ids);
    draft = withWallSurface(draft, '300');
    draft = { ...draft, title: 'Test project', proposedPrice: '5000' };
    const issued1 = issueRevision(draft, (r) => buildCustomerDocument(r, { estimateNumber: 'E-1', estimateDate: '2026-01-01', projectAddress: '', revisionLabel: 'Rev 1' }), ids);
    const issued1Snapshot = JSON.parse(JSON.stringify(issued1));

    const draft2 = createDraftFromIssued(issued1, ids);
    expect(draft2.state).toBe('draft');
    expect(draft2.revisionNumber).toBe(issued1.revisionNumber + 1);
    expect(draft2.preRefreshCheckpoint ?? null).toBeNull();

    const changed = withWallSurface(draft2, '600'); // double the area
    const changedResult = assembleProjectEstimate(changed, { priceMode: 'custom', customPriceRaw: '9000' });
    expect(changedResult.calculationState).toBe('complete');

    const readyToIssue = { ...changed, proposedPrice: '9000' };
    const issued2 = issueRevision(readyToIssue, (r) => buildCustomerDocument(r, { estimateNumber: 'E-2', estimateDate: '2026-01-02', projectAddress: '', revisionLabel: 'Rev 2' }), ids);
    expect(issued2.state).toBe('issued');

    const superseded1 = supersede(issued1, ids);
    expect(superseded1.state).toBe('superseded');

    // The ORIGINAL issued1 object, never reassigned, must be byte-identical
    // to its own snapshot taken right after issuing -- supersede() must not
    // have mutated it in place.
    expect(JSON.stringify(issued1)).toBe(JSON.stringify(issued1Snapshot));
  });
});

describe('State transition: estimated -> partial actuals -> complete actuals -> reopened', () => {
  it('walks the actual-cost review lifecycle through evaluateActualReview at every step', () => {
    const baselinePrice = new PEP('5000');
    const baselineCost = new PEP('3000');

    // estimated: no actuals entered yet.
    let review = evaluateActualReview({
      materials: { confirmed: false, amount: null },
      labor: { confirmed: false, amount: null },
      otherExpenses: { confirmed: false, amount: null },
      overhead: { confirmed: false, amount: null },
      baselinePrice, baselineCost,
    });
    expect(review.state).toBe('in_progress');
    expect(review.confirmedCategories).toBe(0);

    // partial actuals: two of four confirmed.
    review = evaluateActualReview({
      materials: { confirmed: true, amount: new PEP('1200') },
      labor: { confirmed: true, amount: new PEP('900') },
      otherExpenses: { confirmed: false, amount: null },
      overhead: { confirmed: false, amount: null },
      baselinePrice, baselineCost,
    });
    expect(review.state).toBe('in_progress');
    expect(review.confirmedCategories).toBe(2);
    expect(review.recordedCostSoFar.toFixed(2)).toBe('2100.00');

    // complete actuals: all four confirmed -- state becomes 'final' and a
    // real profit/margin/variance are computed against the frozen baseline.
    review = evaluateActualReview({
      materials: { confirmed: true, amount: new PEP('1200') },
      labor: { confirmed: true, amount: new PEP('900') },
      otherExpenses: { confirmed: true, amount: new PEP('100') },
      overhead: { confirmed: true, amount: new PEP('315') },
      baselinePrice, baselineCost,
    });
    expect(review.state).toBe('final');
    expect(review.actualCost!.toFixed(2)).toBe('2515.00');
    expect(review.profitAgainstOriginalQuote!.toFixed(2)).toBe('2485.00');
    expect(review.marginRatio!.toFixed(4)).toBe((2485 / 5000).toFixed(4));
    expect(review.totalVariance!.toFixed(2)).toBe('-485.00'); // came in under estimate

    // reopened: re-evaluating the SAME finalized inputs again is idempotent.
    const reopenedReview = evaluateActualReview({
      materials: { confirmed: true, amount: new PEP('1200') },
      labor: { confirmed: true, amount: new PEP('900') },
      otherExpenses: { confirmed: true, amount: new PEP('100') },
      overhead: { confirmed: true, amount: new PEP('315') },
      baselinePrice, baselineCost,
    });
    expect(reopenedReview.state).toBe('final');
    expect(reopenedReview.actualCost!.toFixed(2)).toBe(review.actualCost!.toFixed(2));
  });
});

describe('State transition: exported -> previewed -> cancelled (no writes)', () => {
  it('planning a restore merge and then discarding it never mutates the original project data', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(makeSettings(), [makeVariant()], [], ids, 'rev-1');
    let draft = createDraftRevision('project-1', snapshot, ids);
    draft = withWallSurface(draft, '300');
    const project: Project = {
      id: 'project-1', title: 'Original', revisions: [draft], activeRevisionId: draft.id,
      actualReviews: [], createdAt: ids.now(), updatedAt: ids.now(), version: 1,
    };
    const originalSnapshot = JSON.parse(JSON.stringify(project));

    const envelope = exportBackup('install-1', snapshot.businessSettings, snapshot.paintVariants, [], [], [project], ids);
    const validated = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    // "previewed": plan the merge (this must be read-only, no side effects).
    const plan = planFullRestoreMerge(
      { businessSettings: snapshot.businessSettings, paintVariants: snapshot.paintVariants, otherMaterials: [], serviceDefinitions: [], projects: [project] },
      { businessSettings: validated.envelope.businessSettings, paintVariants: validated.envelope.paintVariants, otherMaterials: validated.envelope.otherMaterials, serviceDefinitions: validated.envelope.serviceDefinitions, projects: validated.envelope.projects }
    );
    expect(plan).toBeDefined();

    // "cancelled": the caller simply discards the plan without ever calling
    // applyFullRestoreResolutions. The original project must be untouched.
    expect(JSON.stringify(project)).toBe(JSON.stringify(originalSnapshot));
  });
});

describe('State transition: exported -> imported as copy', () => {
  it('import-as-copy produces a numerically-identical but distinctly-ID\'d project, original untouched', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(makeSettings(), [makeVariant()], [], ids, 'rev-1');
    let draft = createDraftRevision('project-1', snapshot, ids);
    draft = withWallSurface(draft, '300');
    draft = { ...draft, title: 'Original project', proposedPrice: '5000' };
    const originalResult = assembleProjectEstimate(draft, { priceMode: 'custom', customPriceRaw: '5000' });

    const project: Project = {
      id: 'project-1', title: 'Original project', revisions: [draft], activeRevisionId: draft.id,
      actualReviews: [], createdAt: ids.now(), updatedAt: ids.now(), version: 1,
    };

    const plan = planImportAsCopies([project], 'export-1', new Set(), ids, false);
    expect(plan.projects).toHaveLength(1);
    const copy = plan.projects[0];
    expect(copy.id).not.toBe(project.id);
    expect(copy.revisions[0].id).not.toBe(draft.id);

    const copyResult = assembleProjectEstimate(copy.revisions[0], { priceMode: 'custom', customPriceRaw: copy.revisions[0].proposedPrice ?? '' });
    expect(copyResult.calculationState).toBe(originalResult.calculationState);
    expect(copyResult.jobCost!.toFixed(2)).toBe(originalResult.jobCost!.toFixed(2));

    // original untouched
    expect(project.id).toBe('project-1');
    expect(project.revisions[0].id).toBe(draft.id);
  });
});
