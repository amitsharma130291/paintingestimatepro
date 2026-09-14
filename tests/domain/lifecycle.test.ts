// LIFE + CAT: draft/catalog snapshot immutability, issued-revision
// immutability, and the "new draft from issued" lifecycle.
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision, issueRevision, createDraftFromIssued, supersede, duplicateProject } from '../../src/domain/project';
import { buildCustomerDocument, assertOnlyAllowedFields } from '../../src/domain/customerDocument';
import type { BusinessSettings, PaintVariant, Project, EstimateRevision } from '../../src/domain/entities';

function makeSettings(rate: string): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'settings-1',
    loadedHourlyRate: rate,
    overheadRatio: '0.15',
    targetMarginRatio: '0.35',
    defaultCoats: 2,
    defaultWasteRatio: '0.10',
    wallThroughput: '150',
    ceilingThroughput: '120',
    trimThroughput: '40',
    doorHoursPerSidePerCoat: '0.75',
    defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' },
    sampleAssumptionsConfirmed: true,
    createdAt: now,
    updatedAt: now,
  };
}

function makeVariant(price: string): PaintVariant {
  const now = '2026-01-01T00:00:00.000Z';
  return { id: 'paint-1', name: 'Sample White', color: 'white', sheen: 'eggshell', pricePerGal: price, coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: now, updatedAt: now };
}

describe('LIFE-D01: draft snapshot survives a live catalog edit', () => {
  it('a draft created at paint $42 still shows $42 after the live catalog changes to $49; a NEW draft shows $49', () => {
    const ids = sequentialIdSource();
    const settingsV1 = makeSettings('32');
    const variantV1 = makeVariant('42');

    const snapshotAtDraftTime = createSnapshot(settingsV1, [variantV1], [], ids, 'rev-1');
    const draft = createDraftRevision('project-1', snapshotAtDraftTime, ids);

    // Live catalog changes AFTER the draft was created.
    const variantV2 = { ...variantV1, pricePerGal: '49', updatedAt: ids.now() };

    // The draft's own snapshot must be untouched by the live edit.
    expect(draft.activeRateSnapshot.paintVariants[0].pricePerGal).toBe('42');
    expect(variantV2.pricePerGal).toBe('49'); // sanity: the live value really did change

    // A brand-new draft, snapshotting current (post-edit) live state, sees $49.
    const newSnapshot = createSnapshot(settingsV1, [variantV2], [], ids, 'rev-2');
    const newDraft = createDraftRevision('project-1', newSnapshot, ids);
    expect(newDraft.activeRateSnapshot.paintVariants[0].pricePerGal).toBe('49');
  });

  it('mutating the returned snapshot object never touches the source settings/catalog objects (deep copy, not a reference)', () => {
    const ids = sequentialIdSource();
    const settings = makeSettings('32');
    const variant = makeVariant('42');
    const snapshot = createSnapshot(settings, [variant], [], ids, 'rev-1');

    snapshot.businessSettings.loadedHourlyRate = '999';
    snapshot.paintVariants[0].pricePerGal = '999';

    expect(settings.loadedHourlyRate).toBe('32');
    expect(variant.pricePerGal).toBe('42');
  });
});

describe('LIFE-D02: issuing freezes a revision; editing after issue creates a NEW draft, original unchanged', () => {
  it('the issued revision object is never mutated by a later edit', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(makeSettings('32'), [makeVariant('42')], [], ids, 'rev-1');
    let draft = createDraftRevision('project-1', snapshot, ids);
    draft = { ...draft, title: 'Original job', proposedPrice: '3200', calculationState: 'complete' };

    const issued = issueRevision(draft, (r) => buildCustomerDocument(r, { estimateNumber: 'E-1', estimateDate: '2026-01-02', projectAddress: '', revisionLabel: 'Rev 1' }), ids);
    expect(issued.state).toBe('issued');
    expect(issued.customerDocumentSnapshot).not.toBeNull();

    const issuedSnapshotBefore = JSON.parse(JSON.stringify(issued));

    // Someone later "edits" — in this architecture that MUST produce a new
    // draft revision, never mutate `issued`.
    const newDraft = createDraftFromIssued(issued, ids);
    newDraft.title = 'Edited job'; // mutate the NEW draft freely
    newDraft.rooms.push({} as never); // even a structural mutation on the copy

    expect(issued).toEqual(issuedSnapshotBefore); // original untouched, byte-for-byte
    expect(newDraft.id).not.toBe(issued.id);
    expect(newDraft.state).toBe('draft');
    expect(newDraft.revisionNumber).toBe(issued.revisionNumber + 1);
    expect(newDraft.issuedAt).toBeNull();
    expect(newDraft.customerDocumentSnapshot).toBeNull();
  });

  it('creating a draft from an issued revision does NOT itself supersede the issued one; only a new issue does', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(makeSettings('32'), [makeVariant('42')], [], ids, 'rev-1');
    let draft = createDraftRevision('project-1', snapshot, ids);
    draft = { ...draft, title: 'Job', proposedPrice: '100', calculationState: 'complete' };
    const issued = issueRevision(draft, (r) => buildCustomerDocument(r, { estimateNumber: 'E-1', estimateDate: '2026-01-02', projectAddress: '', revisionLabel: 'Rev 1' }), ids);

    const newDraft = createDraftFromIssued(issued, ids);
    expect(issued.state).toBe('issued'); // NOT superseded merely by drafting

    const reissued = issueRevision(newDraft, (r) => buildCustomerDocument(r, { estimateNumber: 'E-1', estimateDate: '2026-01-03', projectAddress: '', revisionLabel: 'Rev 2' }), ids);
    const supersededOriginal = supersede(issued, ids);
    expect(supersededOriginal.state).toBe('superseded'); // only now, explicitly
    expect(reissued.state).toBe('issued');
  });
});

describe('DOC-P01: customer document allow-list', () => {
  it('never exposes internal cost/margin fields even if present on the source revision', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(makeSettings('32'), [makeVariant('42')], [], ids, 'rev-1');
    const draft = createDraftRevision('project-1', snapshot, ids);
    const withInternals: EstimateRevision = {
      ...draft,
      title: 'Job',
      proposedPrice: '3200',
      rawCalculatedOutputs: { estimatedJobCost: '2185.00', estimatedMargin: '0.317', overheadAmount: '285.00' },
    };
    const doc = buildCustomerDocument(withInternals, { estimateNumber: 'E-1', estimateDate: '2026-01-02', projectAddress: '', revisionLabel: 'Rev 1' });
    expect(() => assertOnlyAllowedFields(doc as unknown as Record<string, unknown>)).not.toThrow();
    expect(JSON.stringify(doc)).not.toContain('2185.00');
    expect(JSON.stringify(doc)).not.toContain('estimatedMargin');
  });

  it('a hand-assembled object with a leaked private field is caught by the allow-list guard', () => {
    const leaked = { estimateNumber: 'E-1', estimateDate: '2026-01-01', businessInfo: {}, customerInfo: {}, projectTitle: '', projectAddress: '', scopeLines: [], proposedPrice: '100', notes: '', terms: '', revisionLabel: '', taxNotice: '', status: 'draft', estimatedMargin: '0.317' };
    expect(() => assertOnlyAllowedFields(leaked)).toThrow(/estimatedMargin/);
  });
});

describe('LIFE-D07: duplicating a project gets fresh IDs and drops issued/actual state', () => {
  it('produces independent nested objects with correctly remapped room/surface links', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(makeSettings('32'), [makeVariant('42')], [], ids, 'rev-1');
    let revision = createDraftRevision('project-1', snapshot, ids);
    revision = {
      ...revision,
      rooms: [{ id: 'room-A', name: 'Bedroom', lengthFt: '10', widthFt: '10', heightFt: '8', deductionEnabled: true, openingMode: 'quick', quick: { doorCount: 1, windowCount: 1, doorAreaEach: '20', windowAreaEach: '15' }, openings: [], surfaceIds: ['surf-A'] }],
      surfaces: [{ id: 'surf-A', roomId: 'room-A', kind: 'wall', enabled: true, measurementMode: 'roomDerived', areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1', loadedHourlyRate: '32', throughput: '150', hoursPerSidePerCoat: null }],
      title: 'Original',
    };
    const issuedSource = issueRevision(revision, (r) => buildCustomerDocument(r, { estimateNumber: 'E-1', estimateDate: '2026-01-02', projectAddress: '', revisionLabel: 'Rev 1' }), ids);

    const project: Project = {
      id: 'project-1',
      title: 'Original',
      revisions: [issuedSource],
      activeRevisionId: issuedSource.id,
      actualReviews: [{ id: 'ar-1', projectId: 'project-1', baselineIssuedRevisionId: issuedSource.id, state: 'final', materials: { confirmed: true, amount: '700' }, labor: { confirmed: true, amount: '1400' }, otherExpenses: { confirmed: true, amount: '100' }, overhead: { confirmed: true, amount: '285', mode: 'baselineAllocation' }, updatedAt: ids.now() }],
      createdAt: ids.now(),
      updatedAt: ids.now(),
    };

    const copy = duplicateProject(project, ids);

    expect(copy.id).not.toBe(project.id);
    expect(copy.revisions[0].id).not.toBe(issuedSource.id);
    expect(copy.revisions[0].state).toBe('draft'); // drops issued state
    expect(copy.actualReviews).toHaveLength(0); // drops actuals
    expect(copy.revisions[0].rooms[0].id).not.toBe('room-A');
    expect(copy.revisions[0].surfaces[0].id).not.toBe('surf-A');
    // The surface's roomId must point at the COPY's new room id, not the original.
    expect(copy.revisions[0].surfaces[0].roomId).toBe(copy.revisions[0].rooms[0].id);
    // Room's surfaceIds must point at the COPY's new surface id.
    expect(copy.revisions[0].rooms[0].surfaceIds[0]).toBe(copy.revisions[0].surfaces[0].id);

    // Mutating the copy must never affect the source (no shared array/object refs).
    copy.revisions[0].rooms[0].name = 'Changed';
    expect(project.revisions[0].rooms[0].name).toBe('Bedroom');
  });
});
