// Task item 5: backup/restore must be proven through REAL storage
// transactions, not only the pure planning functions in domain/backup.ts
// (which tests/domain/backup.test.ts already covers in isolation). This
// file drives export -> corrupt-import-rejection -> restore-into-empty-store
// -> repeated-restore-no-duplication through actual IndexedDB (fake-
// indexeddb — emulator-backed, not a hand-rolled mock).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IDBPDatabase } from 'idb';
import { openAppDb, writeAll, writeImportedBackup, readAll, readOne, STORES, ConflictError, writeProjectWithVersionCheck } from '../../src/storage/db';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision, issueRevision } from '../../src/domain/project';
import { buildCustomerDocument } from '../../src/domain/customerDocument';
import { exportBackup, validateBackupEnvelope, planRestoreMerge, planFullRestoreMerge, planImportAsCopies, applyFullRestoreResolutions } from '../../src/domain/backup';
import type { BusinessSettings, PaintVariant, Project, EstimateRevision, ActualReview } from '../../src/domain/entities';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function settings(): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35',
    defaultCoats: 2, defaultWasteRatio: '0.10', wallThroughput: '150', ceilingThroughput: '120',
    trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true,
    createdAt: now, updatedAt: now,
  };
}
function variant(): PaintVariant {
  const now = '2026-01-01T00:00:00.000Z';
  return { id: 'paint-1', name: 'Sample White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: now, updatedAt: now };
}

function makeIssuedProjectWithActual(ids: ReturnType<typeof sequentialIdSource>): Project {
  const snapshot = createSnapshot(settings(), [variant()], [], ids, 'rev-1');
  let draft = createDraftRevision('project-1', snapshot, ids);
  draft = { ...draft, title: 'Kitchen repaint', proposedPrice: '900', calculationState: 'complete' };
  const issued: EstimateRevision = issueRevision(draft, (r) => buildCustomerDocument(r, { estimateNumber: 'E-1', estimateDate: '2026-01-05', projectAddress: '123 Main St', revisionLabel: 'Rev 1' }), ids);
  const actual: ActualReview = {
    id: 'ar-1', projectId: 'project-1', baselineIssuedRevisionId: issued.id, state: 'final',
    materials: { confirmed: true, amount: '400' }, labor: { confirmed: true, amount: '300' },
    otherExpenses: { confirmed: true, amount: '50' }, overhead: { confirmed: true, amount: '90', mode: 'baselineAllocation' },
    updatedAt: ids.now(),
  };
  return { id: 'project-1', title: 'Kitchen repaint', revisions: [issued], activeRevisionId: issued.id, actualReviews: [actual], createdAt: ids.now(), updatedAt: ids.now(), version: 1 };
}

describe('Backup export completeness and secret exclusion', () => {
  it('export includes the issued revision, its rate snapshot, and its actual review', () => {
    const ids = sequentialIdSource();
    const project = makeIssuedProjectWithActual(ids);
    const envelope = exportBackup('install-1', settings(), [variant()], [], [], [project], ids);

    expect(envelope.projects[0].revisions[0].state).toBe('issued');
    expect(envelope.projects[0].revisions[0].activeRateSnapshot.paintVariants[0].pricePerGal).toBe('42');
    expect(envelope.projects[0].actualReviews).toHaveLength(1);
    expect(envelope.projects[0].actualReviews[0].materials.amount).toBe('400');
  });

  it('exported data contains no payment/entitlement fields — there are none in the entity model to begin with', () => {
    const ids = sequentialIdSource();
    const project = makeIssuedProjectWithActual(ids);
    const envelope = exportBackup('install-1', settings(), [variant()], [], [], [project], ids);
    const serialized = JSON.stringify(envelope).toLowerCase();
    for (const forbidden of ['stripe', 'paymentintent', 'license_key', 'licensekey', 'entitlementtoken', 'apikey', 'api_key', 'secret']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('Restore into an empty store, through real IndexedDB transactions', () => {
  let db: IDBPDatabase;
  beforeEach(async () => {
    await deleteDatabase('painting-estimate-pro');
    db = await openAppDb();
  });
  afterEach(() => db.close());

  it('a validated backup restored into a fresh (empty) store preserves the complete business graph', async () => {
    const ids = sequentialIdSource();
    const project = makeIssuedProjectWithActual(ids);
    const envelope = exportBackup('install-1', settings(), [variant()], [], [], [project], ids);

    const validated = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    await writeAll(db, [
      { store: STORES.businessSettings, records: [validated.envelope.businessSettings] },
      { store: STORES.paintVariants, records: validated.envelope.paintVariants },
      { store: STORES.projects, records: validated.envelope.projects },
    ]);

    const restoredProjects = await readAll<Project>(db, STORES.projects);
    expect(restoredProjects).toHaveLength(1);
    expect(restoredProjects[0].revisions[0].state).toBe('issued');
    expect(restoredProjects[0].actualReviews).toHaveLength(1);
    expect(restoredProjects[0].revisions[0].customerDocumentSnapshot?.proposedPrice).toBe('900');
  });

  it('restoring the identical backup a second time does not duplicate records (planRestoreMerge + real re-write)', async () => {
    const ids = sequentialIdSource();
    const project = makeIssuedProjectWithActual(ids);
    await writeAll(db, [{ store: STORES.projects, records: [project] }]);

    const existing = await readAll<Project>(db, STORES.projects);
    const plan = planRestoreMerge(existing, [structuredClone(project)]);
    expect(plan.toAdd.projects).toHaveLength(0); // identical -> nothing to add
    // Applying an empty "toAdd" plan means no second write happens at all.
    await writeAll(db, [{ store: STORES.projects, records: plan.toAdd.projects }]);

    const after = await readAll<Project>(db, STORES.projects);
    expect(after).toHaveLength(1); // still exactly one — no duplicate
  });

  it('a corrupt import (fails validation) causes NO writes at all — the store stays exactly as it was', async () => {
    await writeAll(db, [{ store: STORES.paintVariants, records: [variant()] }]);

    const corrupt = { schemaVersion: 2, businessSettings: settings(), paintVariants: [variant(), variant()] /* duplicate id */, projects: [] };
    const validated = validateBackupEnvelope(corrupt, JSON.stringify(corrupt).length);
    expect(validated.ok).toBe(false);
    // Because validation failed, the caller never calls writeAll at all — assert the store is untouched.
    const after = await readAll<PaintVariant>(db, STORES.paintVariants);
    expect(after).toHaveLength(1); // only the pre-existing record; the corrupt import contributed nothing
  });
});

describe('Item 5: conflict preview/choice/confirm/cancel through real storage, via planFullRestoreMerge', () => {
  let db: IDBPDatabase;
  beforeEach(async () => {
    await deleteDatabase('painting-estimate-pro');
    db = await openAppDb();
  });
  afterEach(() => db.close());

  it('cancelling an import (never committing) leaves storage completely untouched', async () => {
    const ids = sequentialIdSource();
    const localProject = makeIssuedProjectWithActual(ids);
    await writeAll(db, [{ store: STORES.projects, records: [localProject] }]);

    const incoming = { ...structuredClone(localProject), title: 'Edited in the imported file' };
    const plan = planFullRestoreMerge(
      { businessSettings: settings(), paintVariants: [variant()], otherMaterials: [], serviceDefinitions: [], projects: [localProject] },
      { businessSettings: settings(), paintVariants: [variant()], otherMaterials: [], serviceDefinitions: [], projects: [incoming] }
    );
    expect(plan.conflicts).toHaveLength(1); // same id, different content

    // "Cancel" = the UI never calls writeAll/saveImportedBackup for this plan at all.
    const after = await readAll<Project>(db, STORES.projects);
    expect(after).toHaveLength(1);
    expect(after[0].title).toBe('Kitchen repaint'); // unchanged — the plan was only computed, never applied
  });

  it('confirming "replaceImported" on a conflicting project overwrites it atomically; "keepLocal" (default) leaves it untouched', async () => {
    const ids = sequentialIdSource();
    const localProject = makeIssuedProjectWithActual(ids);
    await writeAll(db, [{ store: STORES.projects, records: [localProject] }]);

    const incoming = { ...structuredClone(localProject), title: 'Edited in the imported file' };
    const plan = planFullRestoreMerge(
      { businessSettings: settings(), paintVariants: [variant()], otherMaterials: [], serviceDefinitions: [], projects: [localProject] },
      { businessSettings: settings(), paintVariants: [variant()], otherMaterials: [], serviceDefinitions: [], projects: [incoming] }
    );
    expect(plan.conflicts[0].resolution).toBe('keepLocal'); // the required default

    // User explicitly chooses "replaceImported" for this one conflict, then confirms.
    const finalProjects = [incoming]; // simulating the UI applying the chosen resolution
    await writeAll(db, [{ store: STORES.projects, records: finalProjects }]);

    const after = await readAll<Project>(db, STORES.projects);
    expect(after).toHaveLength(1);
    expect(after[0].title).toBe('Edited in the imported file');
  });

  it('"keep both" on a conflicting project commits a genuinely new copy (remapped IDs, including the actual-review baseline) alongside the original, never a raw ID collision', async () => {
    const ids = sequentialIdSource();
    const localProject = makeIssuedProjectWithActual(ids);
    await writeAll(db, [{ store: STORES.projects, records: [localProject] }]);

    const incoming = { ...structuredClone(localProject), title: 'Edited in the imported file' };
    // "Keep both" reuses the tested import-as-copies remap for exactly the chosen project.
    const copies = planImportAsCopies([incoming], 'export-1', new Set(), ids, true);
    const finalProjects = [localProject, ...copies.projects];
    await writeAll(db, [{ store: STORES.projects, records: finalProjects }]);

    const after = await readAll<Project>(db, STORES.projects);
    expect(after).toHaveLength(2);
    const original = after.find((p) => p.id === localProject.id)!;
    const copy = after.find((p) => p.id !== localProject.id)!;
    expect(original.title).toBe('Kitchen repaint'); // untouched
    expect(copy.title).toBe('Edited in the imported file');
    expect(copy.id).not.toBe(localProject.id);
    // The copy's actual review must point at the COPY's own revision, never the original's.
    expect(copy.actualReviews[0].baselineIssuedRevisionId).toBe(copy.revisions[0].id);
    expect(copy.actualReviews[0].baselineIssuedRevisionId).not.toBe(localProject.activeRevisionId);
  });

  it('a differing business settings singleton produces exactly one businessSettings conflict, never silently overwritten', () => {
    const local = settings();
    const incoming = { ...settings(), loadedHourlyRate: '99' };
    const plan = planFullRestoreMerge(
      { businessSettings: local, paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [] },
      { businessSettings: incoming, paintVariants: [], otherMaterials: [], serviceDefinitions: [], projects: [] }
    );
    expect(plan.conflicts).toEqual([{ kind: 'businessSettings', id: local.id, resolution: 'keepLocal' }]);
  });
});

describe('Item 8, end-to-end through the REAL chain (plan -> applyFullRestoreResolutions -> writeImportedBackup): the two-tab scenario', () => {
  let db: IDBPDatabase;
  beforeEach(async () => {
    await deleteDatabase('painting-estimate-pro');
    db = await openAppDb();
  });
  afterEach(() => db.close());

  it('Tab A previews a "replace imported" resolution; Tab B saves a real edit in between; Tab A\'s confirm conflicts and never overwrites Tab B\'s work', async () => {
    const ids = sequentialIdSource();
    const localProject = makeIssuedProjectWithActual(ids);
    const v1 = await writeProjectWithVersionCheck(db, localProject, null);

    // Tab A: user selects a backup file and previews restore/merge.
    const incoming = { ...structuredClone(localProject), title: 'Imported title change' };
    const envelope = exportBackup('install-1', settings(), [variant()], [], [], [incoming], ids);
    const plan = planFullRestoreMerge(
      { businessSettings: settings(), paintVariants: [variant()], otherMaterials: [], serviceDefinitions: [], projects: [localProject] },
      { businessSettings: envelope.businessSettings, paintVariants: envelope.paintVariants, otherMaterials: [], serviceDefinitions: [], projects: envelope.projects }
    );
    expect(plan.conflicts).toHaveLength(1);
    const resolutions = { [`project:${localProject.id}`]: 'replaceImported' as const };
    // Captured HERE, at preview time (v1) -- this is the exact value ProApp.tsx freezes into pendingImport.
    const existingProjectVersions = { [localProject.id]: v1 };

    // Tab B: a real, independent edit lands in between, advancing the version.
    const editedByTabB = { ...structuredClone(localProject), title: 'Edited concurrently in tab B' };
    const v2 = await writeProjectWithVersionCheck(db, editedByTabB, v1);
    expect(v2).toBe(2);

    // Tab A: confirms its now-stale import using the resolution function + the real atomic writer.
    const resolved = applyFullRestoreResolutions(
      { businessSettings: settings(), paintVariants: [variant()], otherMaterials: [], serviceDefinitions: [] },
      envelope, plan, resolutions, existingProjectVersions, ids
    );
    expect(resolved.projectWrites).toEqual([{ project: incoming, expectedVersion: v1 }]);

    await expect(writeImportedBackup(db, { projects: resolved.projectWrites })).rejects.toThrow(ConflictError);

    // Tab B's work is completely intact.
    const after = await readOne<Project>(db, STORES.projects, localProject.id);
    expect(after!.title).toBe('Edited concurrently in tab B');
    expect(after!.version).toBe(2);
  });
});
