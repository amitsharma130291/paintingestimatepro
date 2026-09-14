// BACK: backup validation, restore/merge, and import-as-copies.
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { validateBackupEnvelope, planRestoreMerge, planFullRestoreMerge, planImportAsCopies, exportBackup } from '../../src/domain/backup';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision } from '../../src/domain/project';
import type { BusinessSettings, PaintVariant, Project } from '../../src/domain/entities';

function makeSettings(): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'settings-1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: now, updatedAt: now,
  };
}
function makeVariant(): PaintVariant {
  const now = '2026-01-01T00:00:00.000Z';
  return { id: 'paint-1', name: 'Sample White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: now, updatedAt: now };
}
function makeProject(id: string, ids: ReturnType<typeof sequentialIdSource>): Project {
  const snapshot = createSnapshot(makeSettings(), [makeVariant()], [], ids, 'rev-1');
  const revision = createDraftRevision(id, snapshot, ids);
  return { id, title: `Project ${id}`, revisions: [revision], activeRevisionId: revision.id, actualReviews: [], createdAt: ids.now(), updatedAt: ids.now(), version: 1 };
}

describe('BACK-D11: validation rejects before any write', () => {
  it('rejects a wrong/missing schemaVersion', () => {
    const result = validateBackupEnvelope({ schemaVersion: 1, businessSettings: {}, paintVariants: [], projects: [] }, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path === 'schemaVersion')).toBe(true);
  });

  it('rejects an oversized file before parsing further', () => {
    const result = validateBackupEnvelope({ schemaVersion: 2, businessSettings: {}, paintVariants: [], projects: [] }, 30 * 1024 * 1024);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate paint variant IDs', () => {
    const dup = makeVariant();
    const result = validateBackupEnvelope({ schemaVersion: 2, businessSettings: makeSettings(), paintVariants: [dup, dup], projects: [] }, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.message.includes('Duplicate'))).toBe(true);
  });

  it('rejects a project revision missing its embedded rate snapshot (dangling reference)', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    // @ts-expect-error deliberately corrupt for the test
    project.revisions[0].activeRateSnapshot = undefined;
    const result = validateBackupEnvelope({ schemaVersion: 2, businessSettings: makeSettings(), paintVariants: [], projects: [project] }, 1000);
    expect(result.ok).toBe(false);
  });

  it('accepts a well-formed envelope', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [project], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(true);
  });
});

describe('BACK-015: an actual-review baseline pointing at a missing revision is a dangling reference', () => {
  it('rejects an actualReview whose baselineIssuedRevisionId does not match any revision in the same project', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const withDanglingActual: Project = {
      ...project,
      actualReviews: [{ id: 'ar-1', projectId: 'p1', baselineIssuedRevisionId: 'revision-that-does-not-exist', state: 'final', materials: { confirmed: true, amount: '100' }, labor: { confirmed: true, amount: '100' }, otherExpenses: { confirmed: true, amount: '0' }, overhead: { confirmed: true, amount: '0', mode: 'actualFlat' }, updatedAt: ids.now() }],
    };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [withDanglingActual], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => /dangling|baseline/i.test(i.message))).toBe(true);
  });

  it('accepts an actualReview whose baseline correctly matches an existing ISSUED revision', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const issuedRevision = { ...project.revisions[0], state: 'issued' as const };
    const withValidActual: Project = {
      ...project,
      revisions: [issuedRevision],
      actualReviews: [{ id: 'ar-1', projectId: 'p1', baselineIssuedRevisionId: issuedRevision.id, state: 'final', materials: { confirmed: true, amount: '100' }, labor: { confirmed: true, amount: '100' }, otherExpenses: { confirmed: true, amount: '0' }, overhead: { confirmed: true, amount: '0', mode: 'actualFlat' }, updatedAt: ids.now() }],
    };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [withValidActual], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(true);
  });
});

describe('BACK-020: unknown enums, negative costs, and non-decimal scalars in imported financial data are rejected, never silently coerced', () => {
  it('rejects a paint variant with a negative price', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const badVariant = { ...makeVariant(), pricePerGal: '-42' };
    const envelope = exportBackup('install-1', makeSettings(), [badVariant], [], [], [project], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('rejects a paint variant with a non-decimal price scalar', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const badVariant = { ...makeVariant(), pricePerGal: 'forty-two' };
    const envelope = exportBackup('install-1', makeSettings(), [badVariant], [], [], [project], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('rejects a revision with an unknown state enum value', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately corrupt enum value for the test
    const corrupted = { ...project, revisions: [{ ...project.revisions[0], state: 'not-a-real-state' as any }] };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [corrupted], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('rejects a revision with a negative proposedPrice', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const corrupted = { ...project, revisions: [{ ...project.revisions[0], proposedPrice: '-500' }] };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [corrupted], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('a null proposedPrice (genuinely unpriced) is still accepted — null is not the same as invalid', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const withNullPrice = { ...project, revisions: [{ ...project.revisions[0], proposedPrice: null }] };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [withNullPrice], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(true);
  });
});

describe('BACK-D09: restore/merge — identical skip, new add, conflicting requires a choice (default keep-local)', () => {
  it('an identical existing project is skipped, not duplicated', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const plan = planRestoreMerge([project], [structuredClone(project)]);
    expect(plan.toAdd.projects).toHaveLength(0);
    expect(plan.toSkip.projectIds).toEqual(['p1']);
    expect(plan.conflicts).toHaveLength(0);
  });

  it('a brand-new project ID is added', () => {
    const ids = sequentialIdSource();
    const existing = makeProject('p1', ids);
    const incoming = makeProject('p2', ids);
    const plan = planRestoreMerge([existing], [incoming]);
    expect(plan.toAdd.projects.map((p) => p.id)).toEqual(['p2']);
  });

  it('same ID, different content -> a conflict defaulting to keep-local (never auto timestamp-wins)', () => {
    const ids = sequentialIdSource();
    const existing = makeProject('p1', ids);
    const incoming = { ...structuredClone(existing), title: 'Edited elsewhere' };
    const plan = planRestoreMerge([existing], [incoming]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].resolution).toBe('keepLocal');
  });

  it('D09 repeated identical restore -> zero duplicates on a second run', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const firstPlan = planRestoreMerge([project], [structuredClone(project)]);
    expect(firstPlan.toAdd.projects).toHaveLength(0);
    const secondPlan = planRestoreMerge([project], [structuredClone(project)]);
    expect(secondPlan.toAdd.projects).toHaveLength(0);
  });
});

describe('BACK-COMPLETE: full schema validation (item 5) — null entries, wrong types, missing fields, duplicate IDs, invalid settings, zero coverage, dangling references, draft-targeting actual reviews', () => {
  it('a null entry inside projects[].revisions[] is rejected with a structured error, never an uncaught exception', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const corrupted = { ...project, revisions: [null] } as unknown as Project;
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [corrupted], ids);
    expect(() => validateBackupEnvelope(envelope, JSON.stringify(envelope).length)).not.toThrow();
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('a null entry inside a revision surfaces[] array is rejected without throwing', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const corrupted = { ...project, revisions: [{ ...project.revisions[0], surfaces: [null] }] } as unknown as Project;
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [corrupted], ids);
    expect(() => validateBackupEnvelope(envelope, JSON.stringify(envelope).length)).not.toThrow();
    expect(validateBackupEnvelope(envelope, JSON.stringify(envelope).length).ok).toBe(false);
  });

  it('a wrong-typed business settings field (overheadRatio as a number, not a decimal string) is rejected', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const badSettings = { ...makeSettings(), overheadRatio: 0.15 as unknown as string };
    const envelope = exportBackup('install-1', badSettings, [makeVariant()], [], [], [project], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('a malformed (non-decimal) business settings field is rejected', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const badSettings = { ...makeSettings(), targetMarginRatio: 'not-a-number' };
    const envelope = exportBackup('install-1', badSettings, [makeVariant()], [], [], [project], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('a room missing its required name field is rejected', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const badRoom = { id: 'room-1', lengthFt: null, widthFt: null, heightFt: null, deductionEnabled: false, openingMode: 'quick', quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' }, openings: [], surfaceIds: [] };
    const corrupted = { ...project, revisions: [{ ...project.revisions[0], rooms: [badRoom] }] } as unknown as Project;
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [corrupted], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('duplicate revision IDs within the same project are rejected', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const rev = project.revisions[0];
    const corrupted = { ...project, revisions: [rev, { ...rev }] };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [corrupted], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('duplicate room IDs within the same revision are rejected', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const room = { id: 'room-1', name: 'Bedroom', lengthFt: '10', widthFt: '10', heightFt: '8', deductionEnabled: false, openingMode: 'quick' as const, quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' }, openings: [], surfaceIds: [] };
    const corrupted = { ...project, revisions: [{ ...project.revisions[0], rooms: [room, { ...room }] }] };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [corrupted], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('duplicate surface IDs within the same revision are rejected', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const surface = { id: 'surf-1', roomId: null, kind: 'wall' as const, enabled: true, measurementMode: 'manual' as const, areaFt2: '100', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null };
    const corrupted = { ...project, revisions: [{ ...project.revisions[0], surfaces: [surface, { ...surface }] }] };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [corrupted], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('a paint variant with zero coverage (a divide-by-zero risk) is rejected, not merely "non-negative"', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const zeroCoverage = { ...makeVariant(), coverageFt2PerGal: '0' };
    const envelope = exportBackup('install-1', makeSettings(), [zeroCoverage], [], [], [project], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('a project whose activeRevisionId does not match any of its own revisions is rejected (dangling reference)', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const corrupted = { ...project, activeRevisionId: 'revision-that-does-not-exist' };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [corrupted], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('a room whose surfaceIds references a surface not present in the revision is rejected (dangling reference)', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const room = { id: 'room-1', name: 'Bedroom', lengthFt: '10', widthFt: '10', heightFt: '8', deductionEnabled: false, openingMode: 'quick' as const, quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' }, openings: [], surfaceIds: ['surface-that-does-not-exist'] };
    const corrupted = { ...project, revisions: [{ ...project.revisions[0], rooms: [room] }] };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [corrupted], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('a surface whose roomId references a room not present in the revision is rejected (dangling reference)', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const surface = { id: 'surf-1', roomId: 'room-that-does-not-exist', kind: 'wall' as const, enabled: true, measurementMode: 'roomDerived' as const, areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: null, loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null };
    const corrupted = { ...project, revisions: [{ ...project.revisions[0], surfaces: [surface] }] };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [corrupted], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('an actual review whose baseline targets a DRAFT revision (never issued) is rejected', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids); // its one revision is a 'draft', never issued
    const draftRevisionId = project.revisions[0].id;
    const withDraftTargetingActual: Project = {
      ...project,
      actualReviews: [{ id: 'ar-1', projectId: 'p1', baselineIssuedRevisionId: draftRevisionId, state: 'final', materials: { confirmed: true, amount: '100' }, labor: { confirmed: true, amount: '100' }, otherExpenses: { confirmed: true, amount: '0' }, overhead: { confirmed: true, amount: '0', mode: 'actualFlat' }, updatedAt: ids.now() }],
    };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [withDraftTargetingActual], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => /issued|draft/i.test(i.message))).toBe(true);
  });

  it('a negative actual-review category amount is rejected (a cost cannot be negative)', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const revisionId = project.revisions[0].id;
    const issuedLikeProject: Project = { ...project, revisions: [{ ...project.revisions[0], state: 'issued' }] };
    const withNegativeCost: Project = {
      ...issuedLikeProject,
      actualReviews: [{ id: 'ar-1', projectId: 'p1', baselineIssuedRevisionId: revisionId, state: 'final', materials: { confirmed: true, amount: '-50' }, labor: { confirmed: true, amount: '100' }, otherExpenses: { confirmed: true, amount: '0' }, overhead: { confirmed: true, amount: '0', mode: 'actualFlat' }, updatedAt: ids.now() }],
    };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [withNegativeCost], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('still accepts a fully well-formed envelope with rooms, surfaces, and a valid issued-baseline actual review', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const room = { id: 'room-1', name: 'Bedroom', lengthFt: '10', widthFt: '10', heightFt: '8', deductionEnabled: false, openingMode: 'quick' as const, quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' }, openings: [], surfaceIds: ['surf-1'] };
    const surface = { id: 'surf-1', roomId: 'room-1', kind: 'wall' as const, enabled: true, measurementMode: 'roomDerived' as const, areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: null, loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null };
    const issuedRevision = { ...project.revisions[0], state: 'issued' as const, rooms: [room], surfaces: [surface] };
    const withValid: Project = {
      ...project,
      revisions: [issuedRevision],
      actualReviews: [{ id: 'ar-1', projectId: 'p1', baselineIssuedRevisionId: issuedRevision.id, state: 'final', materials: { confirmed: true, amount: '100' }, labor: { confirmed: true, amount: '100' }, otherExpenses: { confirmed: true, amount: '0' }, overhead: { confirmed: true, amount: '0', mode: 'actualFlat' }, updatedAt: ids.now() }],
    };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [withValid], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(true);
  });
});

describe('BACK-D05/D06: full restore/merge preview spans projects, paint catalog, and business settings', () => {
  it('an identical settings/catalog/projects triple produces zero conflicts and nothing to add', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const settings = makeSettings();
    const variant = makeVariant();
    const plan = planFullRestoreMerge(
      { businessSettings: settings, paintVariants: [variant], projects: [project] },
      { businessSettings: structuredClone(settings), paintVariants: [structuredClone(variant)], projects: [structuredClone(project)] }
    );
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.toAdd.projects).toHaveLength(0);
    expect(plan.toAdd.paintVariants).toHaveLength(0);
  });

  it('a new paint variant ID is queued to add; a conflicting one is flagged (default keepLocal)', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const settings = makeSettings();
    const localVariant = makeVariant();
    const newVariant = { ...makeVariant(), id: 'paint-2', name: 'New Color' };
    const conflictingVariant = { ...makeVariant(), pricePerGal: '99' }; // same id, different price
    const plan = planFullRestoreMerge(
      { businessSettings: settings, paintVariants: [localVariant], projects: [project] },
      { businessSettings: settings, paintVariants: [newVariant, conflictingVariant], projects: [project] }
    );
    expect(plan.toAdd.paintVariants.map((v) => v.id)).toEqual(['paint-2']);
    expect(plan.conflicts).toContainEqual({ kind: 'paintVariant', id: 'paint-1', resolution: 'keepLocal' });
  });

  it('differing business settings produce exactly one businessSettings conflict, defaulting to keepLocal', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const localSettings = makeSettings();
    const incomingSettings = { ...makeSettings(), loadedHourlyRate: '55' };
    const plan = planFullRestoreMerge(
      { businessSettings: localSettings, paintVariants: [], projects: [project] },
      { businessSettings: incomingSettings, paintVariants: [], projects: [project] }
    );
    expect(plan.conflicts).toEqual([{ kind: 'businessSettings', id: localSettings.id, resolution: 'keepLocal' }]);
  });
});

describe('BACK-D10: import-as-copies — provenance-based skip, full ID remap including actual baselines', () => {
  it('remaps project/revision IDs and the actual-review baseline reference together', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const withActual: Project = {
      ...project,
      actualReviews: [{ id: 'ar-1', projectId: project.id, baselineIssuedRevisionId: project.activeRevisionId, state: 'final', materials: { confirmed: true, amount: '1' }, labor: { confirmed: true, amount: '1' }, otherExpenses: { confirmed: true, amount: '1' }, overhead: { confirmed: true, amount: '1', mode: 'baselineAllocation' }, updatedAt: ids.now() }],
    };
    const result = planImportAsCopies([withActual], 'export-1', new Set(), ids);
    expect(result.projects).toHaveLength(1);
    const copy = result.projects[0];
    expect(copy.id).not.toBe(project.id);
    expect(copy.revisions[0].id).not.toBe(project.activeRevisionId);
    // The actual review's baseline must point at the COPIED revision id, not the original.
    expect(copy.actualReviews[0].baselineIssuedRevisionId).toBe(copy.revisions[0].id);
    expect(result.provenance[0]).toMatchObject({ exportId: 'export-1', sourceProjectId: 'p1', copiedProjectId: copy.id });
  });

  it('drops (never carries over) an actual review whose baseline cannot be remapped, instead of retaining a dangling reference', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const withUnresolvableActual: Project = {
      ...project,
      actualReviews: [{ id: 'ar-1', projectId: project.id, baselineIssuedRevisionId: 'some-revision-not-in-this-project', state: 'final', materials: { confirmed: true, amount: '1' }, labor: { confirmed: true, amount: '1' }, otherExpenses: { confirmed: true, amount: '1' }, overhead: { confirmed: true, amount: '1', mode: 'baselineAllocation' }, updatedAt: ids.now() }],
    };
    const result = planImportAsCopies([withUnresolvableActual], 'export-1', new Set(), ids);
    expect(result.projects).toHaveLength(1);
    // The copy must not carry over an actual review pointing nowhere.
    expect(result.projects[0].actualReviews).toHaveLength(0);
  });

  it('repeat import of the same export skips by provenance unless another copy is explicitly requested', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const alreadyImported = new Set(['p1']);
    const skipped = planImportAsCopies([project], 'export-1', alreadyImported, ids);
    expect(skipped.projects).toHaveLength(0);
    expect(skipped.skippedSourceIds).toEqual(['p1']);

    const forced = planImportAsCopies([project], 'export-1', alreadyImported, ids, true);
    expect(forced.projects).toHaveLength(1);
  });
});
