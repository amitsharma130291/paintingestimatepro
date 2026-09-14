// Task item 7 ("confirmed imports must commit atomically") + item 8
// ("validate the import plan's expected versions/current state within the
// same transaction that performs the write"). Emulator-backed
// (fake-indexeddb) — real IndexedDB transactions, not a hand-rolled mock.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { IDBPDatabase } from 'idb';
import { openAppDb, writeImportedBackup, writeReplaceAllBackup, writeProjectWithVersionCheck, readAll, readOne, STORES, ConflictError } from '../../src/storage/db';
import type { BusinessSettings, PaintVariant, OtherMaterial, ServiceDefinition, Project, ImportProvenanceRecord } from '../../src/domain/entities';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

const NOW = '2026-01-01T00:00:00.000Z';

function settings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}
function variant(overrides: Partial<PaintVariant> = {}): PaintVariant {
  return { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW, ...overrides };
}
function otherMaterial(): OtherMaterial {
  return { id: 'om-1', name: 'Caulk', unit: 'tube', unitCost: '5', createdAt: NOW, updatedAt: NOW };
}
function serviceDef(): ServiceDefinition {
  return {
    id: 'svc-1', name: 'Standard wall', unit: 'ft2', kind: 'wall', paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1',
    loadedHourlyRate: '32', throughput: '150', hoursPerSidePerCoat: null, developedWidthFt: null, widthFt: null, heightFt: null,
    paintedSides: null, additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0', directExpensePerUnit: '0', currentSellingPrice: null,
    createdAt: NOW, updatedAt: NOW,
  };
}
function project(id: string, overrides: Partial<Project> = {}): Project {
  return { id, title: `Project ${id}`, revisions: [], activeRevisionId: 'r1', actualReviews: [], createdAt: NOW, updatedAt: NOW, version: 1, ...overrides };
}

describe('writeImportedBackup: atomic multi-store commit, version-checked per project', () => {
  let db: IDBPDatabase;
  beforeEach(async () => {
    await deleteDatabase('painting-estimate-pro');
    db = await openAppDb();
  });
  afterEach(() => db.close());

  it('commits businessSettings, paintVariants, otherMaterials, serviceDefinitions, projects, and provenance together in one call', async () => {
    const prov: ImportProvenanceRecord = { exportId: 'exp-1', sourceProjectId: 'src-1', copiedProjectId: 'p1', importedAt: NOW };
    const result = await writeImportedBackup(db, {
      businessSettings: settings(),
      paintVariants: [variant()],
      otherMaterials: [otherMaterial()],
      serviceDefinitions: [serviceDef()],
      projects: [{ project: project('p1'), expectedVersion: null }],
      provenance: [prov],
    });
    expect(result.committedProjectVersions.get('p1')).toBe(1);
    expect(await readOne<BusinessSettings>(db, STORES.businessSettings, 's1')).toBeTruthy();
    expect(await readAll<PaintVariant>(db, STORES.paintVariants)).toHaveLength(1);
    expect(await readAll<OtherMaterial>(db, STORES.otherMaterials)).toHaveLength(1);
    expect(await readAll<ServiceDefinition>(db, STORES.serviceDefinitions)).toHaveLength(1);
    expect(await readAll<ImportProvenanceRecord>(db, STORES.importProvenance)).toEqual([prov]);
  });

  it('a new project (expectedVersion=null) is committed at version 1', async () => {
    const result = await writeImportedBackup(db, { projects: [{ project: project('p1'), expectedVersion: null }] });
    expect(result.committedProjectVersions.get('p1')).toBe(1);
  });

  it('THE TWO-TAB SCENARIO (item 8): Tab B saves after Tab A previews an import; Tab A confirming the STALE import conflicts and never overwrites Tab B\'s newer work', async () => {
    // 1. A project exists locally at version 1.
    const v1 = await writeProjectWithVersionCheck(db, project('p1', { title: 'Original title' }), null);
    expect(v1).toBe(1);

    // 2. Tab A opens the import UI and previews a conflict against this
    // project — it captures expectedVersion=1 (what it saw at preview time).
    const previewedExpectedVersion = v1;

    // 3. Tab B, meanwhile, edits and saves the SAME project — advancing it to version 2.
    const v2 = await writeProjectWithVersionCheck(db, project('p1', { title: 'Edited in tab B' }), v1);
    expect(v2).toBe(2);

    // 4. Tab A confirms its (now stale) import, still using the version it saw at preview time.
    const staleImportedProject = project('p1', { title: 'Imported (stale)' });
    await expect(
      writeImportedBackup(db, { projects: [{ project: staleImportedProject, expectedVersion: previewedExpectedVersion }] })
    ).rejects.toThrow(ConflictError);

    // 5. Tab B's newer work is completely intact — never overwritten.
    const after = await readOne<Project>(db, STORES.projects, 'p1');
    expect(after!.title).toBe('Edited in tab B');
    expect(after!.version).toBe(2);
  });

  it('an atomic import touching multiple projects rolls back ALL of them if even one conflicts (no partial commit)', async () => {
    const vA = await writeProjectWithVersionCheck(db, project('pA', { title: 'A original' }), null);
    await writeProjectWithVersionCheck(db, project('pB', { title: 'B original' }), null);
    // Someone else changes pA after the preview was taken.
    await writeProjectWithVersionCheck(db, project('pA', { title: 'A changed elsewhere' }), vA);

    await expect(
      writeImportedBackup(db, {
        projects: [
          { project: project('pA', { title: 'A imported' }), expectedVersion: vA }, // stale -> conflicts
          { project: project('pB', { title: 'B imported' }), expectedVersion: 1 }, // would otherwise succeed
        ],
      })
    ).rejects.toThrow(ConflictError);

    // pB must NOT have been imported either — the whole transaction aborted together.
    const pB = await readOne<Project>(db, STORES.projects, 'pB');
    expect(pB!.title).toBe('B original');
  });

  it('a failed import commit leaves businessSettings/paintVariants untouched too (whole-transaction rollback, not just projects)', async () => {
    await writeProjectWithVersionCheck(db, project('p1'), null);
    // stale expectedVersion (0, but it's actually at 1) forces a conflict
    await expect(
      writeImportedBackup(db, {
        businessSettings: settings({ loadedHourlyRate: '999' }),
        paintVariants: [variant({ pricePerGal: '999' })],
        projects: [{ project: project('p1', { title: 'should not land' }), expectedVersion: 0 }],
      })
    ).rejects.toThrow(ConflictError);
    expect(await readOne<BusinessSettings>(db, STORES.businessSettings, 's1')).toBeUndefined();
    expect(await readAll<PaintVariant>(db, STORES.paintVariants)).toHaveLength(0);
  });
});

describe('writeReplaceAllBackup: full atomic wipe-and-restore', () => {
  let db: IDBPDatabase;
  beforeEach(async () => {
    await deleteDatabase('painting-estimate-pro');
    db = await openAppDb();
  });
  afterEach(() => db.close());

  it('replaces every store completely — a local-only project not in the imported set is gone afterward', async () => {
    await writeProjectWithVersionCheck(db, project('local-only'), null);
    await writeImportedBackup(db, { paintVariants: [variant({ id: 'local-variant' })], projects: [] });

    await writeReplaceAllBackup(db, {
      businessSettings: settings(),
      paintVariants: [variant({ id: 'imported-variant' })],
      otherMaterials: [otherMaterial()],
      serviceDefinitions: [serviceDef()],
      projects: [project('imported-project')],
      provenance: [],
    });

    const projects = await readAll<Project>(db, STORES.projects);
    expect(projects.map((p) => p.id)).toEqual(['imported-project']); // local-only is GONE
    const variants = await readAll<PaintVariant>(db, STORES.paintVariants);
    expect(variants.map((v) => v.id)).toEqual(['imported-variant']); // local-variant is GONE
  });

  it('uses the IMPORTED file\'s own provenance, not the local installation\'s prior history', async () => {
    const importedProvenance = [{ exportId: 'exp-imported', sourceProjectId: 'src-x', copiedProjectId: 'p-x', importedAt: NOW }];
    await writeReplaceAllBackup(db, {
      businessSettings: settings(),
      paintVariants: [],
      otherMaterials: [],
      serviceDefinitions: [],
      projects: [],
      provenance: importedProvenance,
    });
    expect(await readAll(db, STORES.importProvenance)).toEqual(importedProvenance);
  });

});
