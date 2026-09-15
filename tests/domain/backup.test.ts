// BACK: backup validation, restore/merge, and import-as-copies.
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { validateBackupEnvelope, planRestoreMerge, planFullRestoreMerge, planImportAsCopies, applyFullRestoreResolutions, exportBackup } from '../../src/domain/backup';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision } from '../../src/domain/project';
import { applyRateRefresh, undoRateRefresh } from '../../src/domain/rateRefresh';
import type { BusinessSettings, PaintVariant, Project, CustomerDocumentSnapshot } from '../../src/domain/entities';

function makeSettings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'settings-1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: now, updatedAt: now,
    ...overrides,
  };
}
function makeVariant(): PaintVariant {
  const now = '2026-01-01T00:00:00.000Z';
  return { id: 'paint-1', name: 'Sample White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: now, updatedAt: now };
}
function makeIssuedDocument(): CustomerDocumentSnapshot {
  return {
    estimateNumber: 'E-1', estimateDate: '2026-01-01', businessInfo: { name: 'Acme Painting', contact: '555-0100', address: '1 Main St' },
    customerInfo: { name: 'Jane Homeowner', address: '2 Elm St', contact: '555-0200' }, projectTitle: 'Kitchen repaint', projectAddress: '2 Elm St',
    scopeLines: ['Paint kitchen walls'], proposedPrice: '900.00', notes: '', terms: '', revisionLabel: 'Rev 1', taxNotice: '', status: 'issued',
  };
}
function makeProject(id: string, ids: ReturnType<typeof sequentialIdSource>): Project {
  const snapshot = createSnapshot(makeSettings(), [makeVariant()], [], ids, 'rev-1');
  const revision = createDraftRevision(id, snapshot, ids);
  return { id, title: `Project ${id}`, revisions: [revision], activeRevisionId: revision.id, actualReviews: [], createdAt: ids.now(), updatedAt: ids.now(), version: 1 };
}

describe('BACK-D07: exportBackup preserves accumulated importProvenance, never resets it (item 6)', () => {
  it('REGRESSION: a real, non-empty existing provenance list is included in the export, not silently wiped to []', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const existingProvenance = [{ exportId: 'export-old', sourceProjectId: 'src-1', copiedProjectId: 'p1', importedAt: '2026-01-01T00:00:00.000Z' }];
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [project], ids, existingProvenance);
    expect(envelope.importProvenance).toEqual(existingProvenance);
  });

  it('defaults to an empty list when the installation has no accumulated provenance yet', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [project], ids);
    expect(envelope.importProvenance).toEqual([]);
  });
});

describe('BACK-D11: validation rejects before any write', () => {
  it('rejects a wrong/missing schemaVersion', () => {
    const result = validateBackupEnvelope({ schemaVersion: 1, businessSettings: {}, paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [] }, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path === 'schemaVersion')).toBe(true);
  });

  it('rejects an oversized file before parsing further', () => {
    const result = validateBackupEnvelope({ schemaVersion: 2, businessSettings: {}, paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [] }, 30 * 1024 * 1024);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate paint variant IDs', () => {
    const dup = makeVariant();
    const result = validateBackupEnvelope({ schemaVersion: 2, businessSettings: makeSettings(), paintVariants: [dup, dup], otherMaterials: [], serviceDefinitions: [], projects: [] }, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.message.includes('Duplicate'))).toBe(true);
  });

  it('rejects a project revision missing its embedded rate snapshot (dangling reference)', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    // @ts-expect-error deliberately corrupt for the test
    project.revisions[0].activeRateSnapshot = undefined;
    const result = validateBackupEnvelope({ schemaVersion: 2, businessSettings: makeSettings(), paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [project] }, 1000);
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
    const issuedRevision = { ...project.revisions[0], state: 'issued' as const, customerDocumentSnapshot: makeIssuedDocument() };
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

describe('V5-06 (related path): import validation of rawCalculatedOutputs, previously never checked at all', () => {
  it('rejects an imported revision whose rawCalculatedOutputs contains a NaN jobCost', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const issuedRevision = { ...project.revisions[0], state: 'issued' as const, customerDocumentSnapshot: makeIssuedDocument(), rawCalculatedOutputs: { schemaVersion: 1, engineVersion: '2.1.0', jobCost: 'NaN', materials: '0', laborCost: '0', directCost: '0', overhead: '0', effectivePrice: '0', profit: '0', marginRatio: '0' } };
    const withBadOutputs: Project = { ...project, revisions: [issuedRevision] };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [withBadOutputs], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(false);
  });

  it('accepts a null rawCalculatedOutputs (a draft, or an issued revision predating the freeze mechanism)', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const issuedRevision = { ...project.revisions[0], state: 'issued' as const, customerDocumentSnapshot: makeIssuedDocument(), rawCalculatedOutputs: null };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [{ ...project, revisions: [issuedRevision] }], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(true);
  });

  it('accepts a well-formed rawCalculatedOutputs, including a negative profit/margin (a real loss)', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const issuedRevision = { ...project.revisions[0], state: 'issued' as const, customerDocumentSnapshot: makeIssuedDocument(), rawCalculatedOutputs: { schemaVersion: 1, engineVersion: '2.1.0', jobCost: '500', materials: '200', laborCost: '250', directCost: '450', overhead: '50', effectivePrice: '400', profit: '-100', marginRatio: '-0.25' } };
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [{ ...project, revisions: [issuedRevision] }], ids);
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
    const issuedRevision = { ...project.revisions[0], state: 'issued' as const, rooms: [room], surfaces: [surface], customerDocumentSnapshot: makeIssuedDocument() };
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
      { businessSettings: settings, paintVariants: [variant], otherMaterials: [], serviceDefinitions: [], projects: [project] },
      { businessSettings: structuredClone(settings), paintVariants: [structuredClone(variant)], otherMaterials: [], serviceDefinitions: [], projects: [structuredClone(project)] }
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
      { businessSettings: settings, paintVariants: [localVariant], otherMaterials: [], serviceDefinitions: [], projects: [project] },
      { businessSettings: settings, paintVariants: [newVariant, conflictingVariant], otherMaterials: [], serviceDefinitions: [], projects: [project] }
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
      { businessSettings: localSettings, paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [project] },
      { businessSettings: incomingSettings, paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [project] }
    );
    expect(plan.conflicts).toEqual([{ kind: 'businessSettings', id: localSettings.id, resolution: 'keepLocal' }]);
  });
});

describe('applyFullRestoreResolutions: pure resolution-application logic (item 8 concurrency, tested directly)', () => {
  it('keepLocal (default) leaves a conflicting project untouched — no write queued for it at all', () => {
    const ids = sequentialIdSource();
    const localProject = makeProject('p1', ids);
    const incomingProject = { ...structuredClone(localProject), title: 'Imported title' };
    const envelope = exportBackup('install-1', makeSettings(), [], [], [], [incomingProject], ids);
    const plan = planFullRestoreMerge(
      { businessSettings: makeSettings(), paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [localProject] },
      { businessSettings: envelope.businessSettings, paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [incomingProject] }
    );
    const result = applyFullRestoreResolutions(
      { businessSettings: makeSettings(), paintVariants: [], otherMaterials: [], serviceDefinitions: [] },
      envelope, plan, {}, { p1: localProject.version }, ids
    );
    expect(result.projectWrites).toHaveLength(0); // keepLocal writes nothing
  });

  it('replaceImported queues the incoming project with the CAPTURED expectedVersion, not a re-read one', () => {
    const ids = sequentialIdSource();
    const localProject = makeProject('p1', ids);
    const incomingProject = { ...structuredClone(localProject), title: 'Imported title' };
    const envelope = exportBackup('install-1', makeSettings(), [], [], [], [incomingProject], ids);
    const plan = planFullRestoreMerge(
      { businessSettings: makeSettings(), paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [localProject] },
      { businessSettings: envelope.businessSettings, paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [incomingProject] }
    );
    const result = applyFullRestoreResolutions(
      { businessSettings: makeSettings(), paintVariants: [], otherMaterials: [], serviceDefinitions: [] },
      envelope, plan, { 'project:p1': 'replaceImported' }, { p1: 7 }, ids
    );
    expect(result.projectWrites).toEqual([{ project: incomingProject, expectedVersion: 7 }]);
  });

  it('keepBoth produces a genuinely new copy (fresh ID, expectedVersion=null) alongside leaving the original untouched', () => {
    const ids = sequentialIdSource();
    const localProject = makeProject('p1', ids);
    const incomingProject = { ...structuredClone(localProject), title: 'Imported title' };
    const envelope = exportBackup('install-1', makeSettings(), [], [], [], [incomingProject], ids);
    const plan = planFullRestoreMerge(
      { businessSettings: makeSettings(), paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [localProject] },
      { businessSettings: envelope.businessSettings, paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [incomingProject] }
    );
    const result = applyFullRestoreResolutions(
      { businessSettings: makeSettings(), paintVariants: [], otherMaterials: [], serviceDefinitions: [] },
      envelope, plan, { 'project:p1': 'keepBoth' }, { p1: localProject.version }, ids
    );
    expect(result.projectWrites).toHaveLength(1);
    expect(result.projectWrites[0].project.id).not.toBe('p1');
    expect(result.projectWrites[0].expectedVersion).toBeNull();
    expect(result.projectWrites[0].project.title).toBe('Imported title');
  });

  it('a brand-new project (no conflict at all) is always queued with expectedVersion=null', () => {
    const ids = sequentialIdSource();
    const newProject = makeProject('p2', ids);
    const envelope = exportBackup('install-1', makeSettings(), [], [], [], [newProject], ids);
    const plan = planFullRestoreMerge(
      { businessSettings: makeSettings(), paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [] },
      { businessSettings: envelope.businessSettings, paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [newProject] }
    );
    const result = applyFullRestoreResolutions(
      { businessSettings: makeSettings(), paintVariants: [], otherMaterials: [], serviceDefinitions: [] },
      envelope, plan, {}, {}, ids
    );
    expect(result.projectWrites).toEqual([{ project: newProject, expectedVersion: null }]);
  });

  it('businessSettings replaceImported swaps in the incoming settings; keepLocal (default) preserves the local ones', () => {
    const ids = sequentialIdSource();
    const localSettings = makeSettings();
    const incomingSettings = { ...makeSettings(), loadedHourlyRate: '99' };
    const envelope = exportBackup('install-1', incomingSettings, [], [], [], [], ids);
    const plan = planFullRestoreMerge(
      { businessSettings: localSettings, paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [] },
      { businessSettings: incomingSettings, paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [] }
    );
    const kept = applyFullRestoreResolutions({ businessSettings: localSettings, paintVariants: [], otherMaterials: [], serviceDefinitions: [] }, envelope, plan, {}, {}, ids);
    expect(kept.finalSettings).toEqual(localSettings);
    const replaced = applyFullRestoreResolutions({ businessSettings: localSettings, paintVariants: [], otherMaterials: [], serviceDefinitions: [] }, envelope, plan, { [`businessSettings:${localSettings.id}`]: 'replaceImported' }, {}, ids);
    expect(replaced.finalSettings).toEqual(incomingSettings);
  });

  it('a new paint variant is added; a conflicting one keeps local by default, replaces on choice, or keeps-both as a new copy', () => {
    const ids = sequentialIdSource();
    const localVariant = makeVariant();
    const newVariant = { ...makeVariant(), id: 'paint-2', name: 'New' };
    const conflictingIncoming = { ...makeVariant(), pricePerGal: '99' };
    const envelope = exportBackup('install-1', makeSettings(), [newVariant, conflictingIncoming], [], [], [], ids);
    const plan = planFullRestoreMerge(
      { businessSettings: makeSettings(), paintVariants: [localVariant], otherMaterials: [], serviceDefinitions: [], projects: [] },
      { businessSettings: makeSettings(), paintVariants: [newVariant, conflictingIncoming], otherMaterials: [], serviceDefinitions: [], projects: [] }
    );
    const keepLocalResult = applyFullRestoreResolutions({ businessSettings: makeSettings(), paintVariants: [localVariant], otherMaterials: [], serviceDefinitions: [] }, envelope, plan, {}, {}, ids);
    expect(keepLocalResult.finalPaintVariants.find((v) => v.id === 'paint-1')).toEqual(localVariant); // kept local
    expect(keepLocalResult.finalPaintVariants.map((v) => v.id)).toContain('paint-2'); // new one added

    const replaceResult = applyFullRestoreResolutions({ businessSettings: makeSettings(), paintVariants: [localVariant], otherMaterials: [], serviceDefinitions: [] }, envelope, plan, { 'paintVariant:paint-1': 'replaceImported' }, {}, ids);
    expect(replaceResult.finalPaintVariants.find((v) => v.id === 'paint-1')?.pricePerGal).toBe('99');

    const keepBothResult = applyFullRestoreResolutions({ businessSettings: makeSettings(), paintVariants: [localVariant], otherMaterials: [], serviceDefinitions: [] }, envelope, plan, { 'paintVariant:paint-1': 'keepBoth' }, {}, ids);
    expect(keepBothResult.finalPaintVariants).toHaveLength(3); // local paint-1 + new paint-2 + the keepBoth copy
    expect(keepBothResult.finalPaintVariants.filter((v) => v.pricePerGal === '99')).toHaveLength(1);
  });

  it('REGRESSION (independent-review R05): "keep both" on a conflicting paint variant remaps every incoming service definition\'s paintVariantId to the copy, never leaving it pointing at the old local variant', () => {
    const ids = sequentialIdSource();
    const localVariant = makeVariant(); // id 'paint-1', pricePerGal '42'
    const incomingVariant = { ...makeVariant(), pricePerGal: '99' }; // same id, different price -> conflict
    const incomingService = {
      id: 'service-1', name: 'Custom wall service', unit: 'ft2' as const, kind: 'wall' as const, paintVariantId: 'paint-1',
      coats: 2, wasteRatio: '0.1', loadedHourlyRate: '32', throughput: '150', hoursPerSidePerCoat: null, developedWidthFt: null,
      widthFt: null, heightFt: null, paintedSides: null, additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0',
      directExpensePerUnit: '0', currentSellingPrice: '1.80', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const envelope = exportBackup('install-1', makeSettings(), [incomingVariant], [], [incomingService], [], ids);
    const plan = planFullRestoreMerge(
      { businessSettings: makeSettings(), paintVariants: [localVariant], otherMaterials: [], serviceDefinitions: [], projects: [] },
      { businessSettings: makeSettings(), paintVariants: [incomingVariant], otherMaterials: [], serviceDefinitions: [incomingService], projects: [] }
    );
    const result = applyFullRestoreResolutions(
      { businessSettings: makeSettings(), paintVariants: [localVariant], otherMaterials: [], serviceDefinitions: [] },
      envelope, plan, { 'paintVariant:paint-1': 'keepBoth' }, {}, ids
    );
    const copiedVariant = result.finalPaintVariants.find((v) => v.pricePerGal === '99')!;
    expect(copiedVariant.id).not.toBe('paint-1'); // a genuinely new copy
    expect(result.finalServiceDefinitions[0].paintVariantId).toBe(copiedVariant.id); // remapped, not left at 'paint-1'
  });

  it('V5-02: "keep both" on a conflicting paint variant remaps ONLY the incoming service, never a pre-existing LOCAL service that already referenced the same paint ID', () => {
    const ids = sequentialIdSource();
    const localVariant = makeVariant(); // id 'paint-1', pricePerGal '42'
    const incomingVariant = { ...makeVariant(), pricePerGal: '99' }; // same id, different price -> conflict
    const localService = {
      id: 'local-service', name: 'Existing local wall service', unit: 'ft2' as const, kind: 'wall' as const, paintVariantId: 'paint-1',
      coats: 2, wasteRatio: '0.1', loadedHourlyRate: '32', throughput: '150', hoursPerSidePerCoat: null, developedWidthFt: null,
      widthFt: null, heightFt: null, paintedSides: null, additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0',
      directExpensePerUnit: '0', currentSellingPrice: '1.80', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const incomingService = { ...localService, id: 'incoming-service', name: 'Incoming wall service' };
    const envelope = exportBackup('install-1', makeSettings(), [incomingVariant], [], [incomingService], [], ids);
    const plan = planFullRestoreMerge(
      { businessSettings: makeSettings(), paintVariants: [localVariant], otherMaterials: [], serviceDefinitions: [localService], projects: [] },
      { businessSettings: makeSettings(), paintVariants: [incomingVariant], otherMaterials: [], serviceDefinitions: [incomingService], projects: [] }
    );
    const result = applyFullRestoreResolutions(
      { businessSettings: makeSettings(), paintVariants: [localVariant], otherMaterials: [], serviceDefinitions: [localService] },
      envelope, plan, { 'paintVariant:paint-1': 'keepBoth' }, {}, ids
    );
    const copiedVariant = result.finalPaintVariants.find((v) => v.pricePerGal === '99' && v.id !== 'paint-1')!;
    expect(result.finalServiceDefinitions.find((s) => s.id === 'local-service')?.paintVariantId).toBe('paint-1'); // untouched local reference
    expect(result.finalServiceDefinitions.find((s) => s.id === 'incoming-service')?.paintVariantId).toBe(copiedVariant.id); // remapped incoming reference
  });

  it('V5-02: keepLocal and replaceImported on a conflicting paint variant never remap a local service — only keepBoth mints a copy to remap toward', () => {
    const ids = sequentialIdSource();
    const localVariant = makeVariant();
    const incomingVariant = { ...makeVariant(), pricePerGal: '99' };
    const localService = {
      id: 'local-service', name: 'Existing local wall service', unit: 'ft2' as const, kind: 'wall' as const, paintVariantId: 'paint-1',
      coats: 2, wasteRatio: '0.1', loadedHourlyRate: '32', throughput: '150', hoursPerSidePerCoat: null, developedWidthFt: null,
      widthFt: null, heightFt: null, paintedSides: null, additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0',
      directExpensePerUnit: '0', currentSellingPrice: '1.80', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const envelope = exportBackup('install-1', makeSettings(), [incomingVariant], [], [], [], ids);
    const plan = planFullRestoreMerge(
      { businessSettings: makeSettings(), paintVariants: [localVariant], otherMaterials: [], serviceDefinitions: [localService], projects: [] },
      { businessSettings: makeSettings(), paintVariants: [incomingVariant], otherMaterials: [], serviceDefinitions: [], projects: [] }
    );
    const local = { businessSettings: makeSettings(), paintVariants: [localVariant], otherMaterials: [], serviceDefinitions: [localService] };

    const keepLocalResult = applyFullRestoreResolutions(local, envelope, plan, {}, {}, ids);
    expect(keepLocalResult.finalServiceDefinitions[0].paintVariantId).toBe('paint-1');

    const replaceResult = applyFullRestoreResolutions(local, envelope, plan, { 'paintVariant:paint-1': 'replaceImported' }, {}, ids);
    // The local service still references paint-1 by ID -- replaceImported keeps the SAME id, just swaps its content, so no remap is needed or expected.
    expect(replaceResult.finalServiceDefinitions[0].paintVariantId).toBe('paint-1');
    expect(replaceResult.finalPaintVariants.find((v) => v.id === 'paint-1')?.pricePerGal).toBe('99');
  });

  it('a "keep both" project copy returns real provenance, not silently dropped (independent-review §5 secondary finding)', () => {
    const ids = sequentialIdSource();
    const localProject = makeProject('p1', ids);
    const incoming = { ...structuredClone(localProject), title: 'Imported title' };
    const envelope = exportBackup('install-1', makeSettings(), [], [], [], [incoming], ids);
    const plan = planFullRestoreMerge(
      { businessSettings: makeSettings(), paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [localProject] },
      { businessSettings: makeSettings(), paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [incoming] }
    );
    const result = applyFullRestoreResolutions(
      { businessSettings: makeSettings(), paintVariants: [], otherMaterials: [], serviceDefinitions: [] },
      envelope, plan, { 'project:p1': 'keepBoth' }, { p1: localProject.version }, ids
    );
    expect(result.provenance).toHaveLength(1);
    expect(result.provenance[0]).toMatchObject({ exportId: envelope.exportId, sourceProjectId: 'p1' });
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

  it('REGRESSION (item 6): remaps room and surface IDs too, and rewrites their cross-references, not just project/revision IDs', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const room = { id: 'room-1', name: 'Bedroom', lengthFt: '10', widthFt: '10', heightFt: '8', deductionEnabled: false, openingMode: 'quick' as const, quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' }, openings: [], surfaceIds: ['surf-1'] };
    const surface = { id: 'surf-1', roomId: 'room-1', kind: 'wall' as const, enabled: true, measurementMode: 'roomDerived' as const, areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: null, loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null };
    const withRoomAndSurface: Project = { ...project, revisions: [{ ...project.revisions[0], rooms: [room], surfaces: [surface] }] };

    const result = planImportAsCopies([withRoomAndSurface], 'export-1', new Set(), ids);
    const copy = result.projects[0];
    const copiedRoom = copy.revisions[0].rooms[0];
    const copiedSurface = copy.revisions[0].surfaces[0];

    // Fresh IDs throughout — never the original room-1/surf-1.
    expect(copiedRoom.id).not.toBe('room-1');
    expect(copiedSurface.id).not.toBe('surf-1');
    // Cross-references rewritten to point at each other's NEW ids.
    expect(copiedRoom.surfaceIds).toEqual([copiedSurface.id]);
    expect(copiedSurface.roomId).toBe(copiedRoom.id);
  });

  it('a paint-catalog reference (surface.paintVariantId) is preserved as a legitimate shared reference, never remapped', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const surface = { id: 'surf-1', roomId: null, kind: 'wall' as const, enabled: true, measurementMode: 'manual' as const, areaFt2: '100', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null };
    const withSurface: Project = { ...project, revisions: [{ ...project.revisions[0], surfaces: [surface] }] };
    const result = planImportAsCopies([withSurface], 'export-1', new Set(), ids);
    expect(result.projects[0].revisions[0].surfaces[0].paintVariantId).toBe('paint-1'); // unchanged
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

describe('V6-04: import validation of opening counts stays consistent with the calculation engine\'s own guard', () => {
  function projectWithRoom(quickOverrides: Partial<{ doorCount: number; windowCount: number }> = {}, openingCount?: number) {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const room = {
      id: 'room-1', name: 'Bedroom', lengthFt: '20', widthFt: '16', heightFt: '9', deductionEnabled: true, openingMode: (openingCount !== undefined ? 'detailed' : 'quick') as 'quick' | 'detailed',
      quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15', ...quickOverrides },
      openings: openingCount !== undefined ? [{ id: 'o1', type: 'door' as const, widthFt: '3', heightFt: '6.67', count: openingCount }] : [],
      surfaceIds: ['surf-1'],
    };
    const surface = { id: 'surf-1', roomId: 'room-1', kind: 'wall' as const, enabled: true, measurementMode: 'roomDerived' as const, areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null };
    return { ...project, revisions: [{ ...project.revisions[0], rooms: [room], surfaces: [surface] }] };
  }

  it('rejects a negative quick doorCount on import', () => {
    const p = projectWithRoom({ doorCount: -1 });
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [p], sequentialIdSource());
    expect(validateBackupEnvelope(envelope, JSON.stringify(envelope).length).ok).toBe(false);
  });

  it('rejects a quick windowCount above the approved maximum (100001) on import', () => {
    const p = projectWithRoom({ windowCount: 100001 });
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [p], sequentialIdSource());
    expect(validateBackupEnvelope(envelope, JSON.stringify(envelope).length).ok).toBe(false);
  });

  it('rejects a negative detailed opening count on import', () => {
    const p = projectWithRoom({}, -1);
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [p], sequentialIdSource());
    expect(validateBackupEnvelope(envelope, JSON.stringify(envelope).length).ok).toBe(false);
  });

  it('accepts a well-formed quick room within bounds', () => {
    const p = projectWithRoom({ doorCount: 2, windowCount: 3 });
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [p], sequentialIdSource());
    expect(validateBackupEnvelope(envelope, JSON.stringify(envelope).length).ok).toBe(true);
  });
});

describe('V6-02: preRefreshCheckpoint is validated as rigorously as a normal revision before import', () => {
  // Builds a project whose single revision has ALREADY been through a real
  // rate refresh (via the real applyRateRefresh, not a hand-rolled stub),
  // so `preRefreshCheckpoint` is a genuine, fully-formed embedded revision
  // -- exactly what a real backup file contains. Each test below corrupts
  // one specific part of that checkpoint and confirms the whole import is
  // rejected before any write, per DATA_CONTRACT.md D11.
  function projectWithRealCheckpoint(withRoom = false): Project {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    let revision = project.revisions[0];
    if (withRoom) {
      const room = {
        id: 'room-1', name: 'Bedroom', lengthFt: '20', widthFt: '16', heightFt: '9', deductionEnabled: true, openingMode: 'quick' as const,
        quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' }, openings: [], surfaceIds: ['surf-1'],
      };
      const surface = { id: 'surf-1', roomId: 'room-1', kind: 'wall' as const, enabled: true, measurementMode: 'roomDerived' as const, areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null };
      revision = { ...revision, rooms: [room], surfaces: [surface] };
    }
    const liveSnapshot = createSnapshot(makeSettings(), [makeVariant()], [], ids, 'rev-live');
    const refreshed = applyRateRefresh(revision, liveSnapshot, [], ids);
    return { ...project, revisions: [refreshed] };
  }
  function envelopeFor(project: Project) {
    return exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [project], sequentialIdSource());
  }
  function corruptCheckpoint(project: Project, patch: (checkpoint: NonNullable<Project['revisions'][number]['preRefreshCheckpoint']>) => object): Project {
    const revision = project.revisions[0];
    const checkpoint = revision.preRefreshCheckpoint!;
    return { ...project, revisions: [{ ...revision, preRefreshCheckpoint: { ...checkpoint, ...patch(checkpoint) } as typeof checkpoint }] };
  }

  it('a valid checkpoint round-trips through export/import validation and is accepted', () => {
    const project = projectWithRealCheckpoint();
    expect(project.revisions[0].preRefreshCheckpoint).toBeTruthy();
    expect(validateBackupEnvelope(envelopeFor(project), 10_000).ok).toBe(true);
  });

  it('rejects a checkpoint missing its embedded rate snapshot', () => {
    const project = corruptCheckpoint(projectWithRealCheckpoint(), () => ({ activeRateSnapshot: undefined }));
    expect(validateBackupEnvelope(envelopeFor(project), 10_000).ok).toBe(false);
  });

  it('rejects a checkpoint missing its rooms/surfaces arrays entirely', () => {
    const project = corruptCheckpoint(projectWithRealCheckpoint(), () => ({ rooms: undefined, surfaces: undefined }));
    expect(validateBackupEnvelope(envelopeFor(project), 10_000).ok).toBe(false);
  });

  it('rejects a checkpoint whose projectId does not match the containing project', () => {
    const project = corruptCheckpoint(projectWithRealCheckpoint(), () => ({ projectId: 'some-other-project' }));
    const result = validateBackupEnvelope(envelopeFor(project), 10_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path.includes('preRefreshCheckpoint.projectId'))).toBe(true);
  });

  it('rejects a checkpoint whose id does not match its own revision\'s id', () => {
    const project = corruptCheckpoint(projectWithRealCheckpoint(), () => ({ id: 'a-completely-different-revision-id' }));
    const result = validateBackupEnvelope(envelopeFor(project), 10_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path.endsWith('preRefreshCheckpoint.id'))).toBe(true);
  });

  it('the reviewer\'s own minimal repro -- a checkpoint reduced to just {id: rev.id} -- is rejected for missing structure, not silently accepted because the id happens to match', () => {
    const project = projectWithRealCheckpoint();
    const revision = project.revisions[0];
    const withMinimalCheckpoint = { ...project, revisions: [{ ...revision, preRefreshCheckpoint: { id: revision.id } as typeof revision }] };
    expect(validateBackupEnvelope(envelopeFor(withMinimalCheckpoint), 10_000).ok).toBe(false);
  });

  it('rejects a checkpoint with a dangling room->surface reference', () => {
    const project = corruptCheckpoint(projectWithRealCheckpoint(true), (cp) => ({ rooms: cp.rooms.map((r) => ({ ...r, surfaceIds: ['a-surface-that-does-not-exist'] })) }));
    expect(validateBackupEnvelope(envelopeFor(project), 10_000).ok).toBe(false);
  });

  it('rejects a checkpoint with a dangling surface->room reference', () => {
    const project = corruptCheckpoint(projectWithRealCheckpoint(true), (cp) => ({ surfaces: cp.surfaces.map((s) => ({ ...s, roomId: 'a-room-that-does-not-exist' })) }));
    expect(validateBackupEnvelope(envelopeFor(project), 10_000).ok).toBe(false);
  });

  it('rejects a checkpoint with an invalid decimal field on a room', () => {
    const project = corruptCheckpoint(projectWithRealCheckpoint(true), (cp) => ({ rooms: cp.rooms.map((r) => ({ ...r, lengthFt: 'not-a-number' })) }));
    expect(validateBackupEnvelope(envelopeFor(project), 10_000).ok).toBe(false);
  });

  it('rejects a checkpoint with an invalid (negative) opening count', () => {
    const project = corruptCheckpoint(projectWithRealCheckpoint(true), (cp) => ({ rooms: cp.rooms.map((r) => ({ ...r, quick: { ...r.quick, doorCount: -1 } })) }));
    expect(validateBackupEnvelope(envelopeFor(project), 10_000).ok).toBe(false);
  });

  it('rejects a checkpoint carrying its own further-nested checkpoint (bounded to one level)', () => {
    const project = projectWithRealCheckpoint();
    const checkpoint = project.revisions[0].preRefreshCheckpoint!;
    const nested = corruptCheckpoint(project, () => ({ preRefreshCheckpoint: { ...checkpoint } }));
    const result = validateBackupEnvelope(envelopeFor(nested), 10_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => /nested checkpoint/i.test(i.message))).toBe(true);
  });

  it('rejects a checkpoint whose embedded rate snapshot uses an unsupported schema', () => {
    const project = corruptCheckpoint(projectWithRealCheckpoint(), (cp) => ({ activeRateSnapshot: { ...cp.activeRateSnapshot, businessSettings: undefined } }));
    expect(validateBackupEnvelope(envelopeFor(project), 10_000).ok).toBe(false);
  });

  it('a rejected checkpoint import carries no envelope at all -- there is nothing a caller could partially write', () => {
    const project = corruptCheckpoint(projectWithRealCheckpoint(), () => ({ activeRateSnapshot: undefined }));
    const result = validateBackupEnvelope(envelopeFor(project), 10_000);
    expect(result.ok).toBe(false);
    expect('envelope' in result).toBe(false);
  });

  it('a legitimately absent checkpoint (no refresh ever happened) is still fully supported and accepted', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    expect(project.revisions[0].preRefreshCheckpoint).toBeFalsy();
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [project], ids);
    expect(validateBackupEnvelope(envelope, JSON.stringify(envelope).length).ok).toBe(true);
  });
});

describe('V6-03: import-as-copy remaps preRefreshCheckpoint\'s internal identities along with the revision', () => {
  function projectWithRefreshedRevision(ids: ReturnType<typeof sequentialIdSource>): Project {
    const project = makeProject('p1', ids);
    const room = {
      id: 'room-1', name: 'Bedroom', lengthFt: '20', widthFt: '16', heightFt: '9', deductionEnabled: true, openingMode: 'quick' as const,
      quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' }, openings: [], surfaceIds: ['surf-1'],
    };
    const surface = { id: 'surf-1', roomId: 'room-1', kind: 'wall' as const, enabled: true, measurementMode: 'roomDerived' as const, areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null };
    const revisionWithRoom = { ...project.revisions[0], rooms: [room], surfaces: [surface] };
    const liveSnapshot = createSnapshot(makeSettings(), [makeVariant()], [], ids, 'rev-live');
    const refreshed = applyRateRefresh(revisionWithRoom, liveSnapshot, [], ids);
    return { ...project, revisions: [refreshed] };
  }

  it('a normal import-as-copy gives the checkpoint the SAME identity as the copied active revision, not the original', () => {
    const ids = sequentialIdSource();
    const source = projectWithRefreshedRevision(ids);
    const originalRevisionId = source.revisions[0].id;
    const originalCheckpointRoomId = source.revisions[0].preRefreshCheckpoint!.rooms[0].id;

    const copy = planImportAsCopies([source], 'export-1', new Set(), ids).projects[0];
    const copiedRevision = copy.revisions[0];
    const checkpoint = copiedRevision.preRefreshCheckpoint!;

    expect(checkpoint.id).toBe(copiedRevision.id);
    expect(checkpoint.projectId).toBe(copy.id);
    expect(checkpoint.id).not.toBe(originalRevisionId); // a fresh id, not the source's
    expect(checkpoint.rooms[0].id).not.toBe(originalCheckpointRoomId); // the checkpoint's OWN nested ids are remapped too
    expect(checkpoint.rooms[0].surfaceIds).toEqual([checkpoint.surfaces[0].id]); // cross-reference stays internally consistent after remap
    expect(checkpoint.surfaces[0].paintVariantId).toBe('paint-1'); // catalog reference untouched by remap

    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [copy], ids);
    expect(validateBackupEnvelope(envelope, JSON.stringify(envelope).length).ok).toBe(true);
  });

  it('Undo on the copy restores the copy\'s own identity, never the original project/revision', () => {
    const ids = sequentialIdSource();
    const source = projectWithRefreshedRevision(ids);
    const copy = planImportAsCopies([source], 'export-1', new Set(), ids).projects[0];
    const active = copy.revisions[0];

    const undone = undoRateRefresh(active)!;
    expect(undone.projectId).toBe(copy.id);
    expect(undone.id).toBe(active.id);
    expect(undone.projectId).not.toBe(source.id);
  });

  it('exporting the copy after Undo passes full backup validation', () => {
    const ids = sequentialIdSource();
    const source = projectWithRefreshedRevision(ids);
    const copy = planImportAsCopies([source], 'export-1', new Set(), ids).projects[0];
    const undone = undoRateRefresh(copy.revisions[0])!;
    const afterUndo: Project = { ...copy, revisions: [undone] };

    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [afterUndo], ids);
    expect(validateBackupEnvelope(envelope, JSON.stringify(envelope).length).ok).toBe(true);
  });

  it('forcing a SECOND copy of the same source gives each copy\'s checkpoint its own distinct identity (no collision between the two copies)', () => {
    const ids = sequentialIdSource();
    const source = projectWithRefreshedRevision(ids);
    const alreadyImported = new Set<string>(); // first copy is "new" (not yet recorded as imported)
    const firstCopy = planImportAsCopies([source], 'export-1', alreadyImported, ids).projects[0];
    const secondCopy = planImportAsCopies([source], 'export-1', alreadyImported, ids, true).projects[0]; // forced second copy of the same export

    const firstCheckpoint = firstCopy.revisions[0].preRefreshCheckpoint!;
    const secondCheckpoint = secondCopy.revisions[0].preRefreshCheckpoint!;
    expect(firstCheckpoint.id).not.toBe(secondCheckpoint.id);
    expect(firstCheckpoint.projectId).not.toBe(secondCheckpoint.projectId);
    expect(firstCheckpoint.rooms[0].id).not.toBe(secondCheckpoint.rooms[0].id);

    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [firstCopy, secondCopy], ids);
    expect(validateBackupEnvelope(envelope, JSON.stringify(envelope).length).ok).toBe(true);
  });

  it('a repeated refresh/Undo cycle on the copy keeps only the most recent checkpoint, always matching the copy\'s own identity', () => {
    const ids = sequentialIdSource();
    const source = projectWithRefreshedRevision(ids);
    const copy = planImportAsCopies([source], 'export-1', new Set(), ids).projects[0];
    let active = copy.revisions[0];

    // Undo the refresh the copy already had, then refresh AGAIN on the copy itself.
    active = undoRateRefresh(active)!;
    const secondLiveSnapshot = createSnapshot(makeSettings({ loadedHourlyRate: '40' }), [makeVariant()], [], ids, 'rev-live-2');
    active = applyRateRefresh(active, secondLiveSnapshot, [], ids);

    expect(active.preRefreshCheckpoint!.id).toBe(active.id);
    expect(active.preRefreshCheckpoint!.projectId).toBe(copy.id);
    expect(active.preRefreshCheckpoint!.preRefreshCheckpoint).toBeFalsy(); // no accumulated chain

    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [{ ...copy, revisions: [active] }], ids);
    expect(validateBackupEnvelope(envelope, JSON.stringify(envelope).length).ok).toBe(true);
  });
});
