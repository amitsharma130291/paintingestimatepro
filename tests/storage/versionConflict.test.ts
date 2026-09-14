// Emulator-backed (fake-indexeddb) integration tests for task item 6's
// multi-tab conflict policy: a real monotonic version integer, checked and
// incremented INSIDE the write transaction — not a timestamp, which cannot
// reliably distinguish two saves landing in the same millisecond.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openAppDb, writeProjectWithVersionCheck, readOne, STORES, ConflictError } from '../../src/storage/db';
import type { IDBPDatabase } from 'idb';
import type { Project } from '../../src/domain/entities';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

const SAME_TIMESTAMP = '2026-01-01T00:00:00.000Z'; // deliberately identical across writes below

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1', title: 'Job', revisions: [], activeRevisionId: 'r1', actualReviews: [],
    createdAt: SAME_TIMESTAMP, updatedAt: SAME_TIMESTAMP, version: 0, // caller's version is ignored by the function; only expectedVersion matters
    ...overrides,
  };
}

describe('storage/db: version-checked project writes (emulator-backed, fake-indexeddb)', () => {
  let db: IDBPDatabase;

  beforeEach(async () => {
    await deleteDatabase('painting-estimate-pro');
    db = await openAppDb();
  });

  afterEach(() => db.close());

  it('creating a brand-new project (expectedVersion=null) succeeds and commits version 1', async () => {
    const committed = await writeProjectWithVersionCheck(db, project(), null);
    expect(committed).toBe(1);
    const stored = await readOne<Project>(db, STORES.projects, 'p1');
    expect(stored?.title).toBe('Job');
    expect(stored?.version).toBe(1);
  });

  it('creating with expectedVersion=null FAILS if a project with that id already exists (real requirement, not skippable)', async () => {
    await writeProjectWithVersionCheck(db, project(), null);
    await expect(writeProjectWithVersionCheck(db, project({ title: 'Duplicate id' }), null)).rejects.toBeInstanceOf(ConflictError);
    const stored = await readOne<Project>(db, STORES.projects, 'p1');
    expect(stored?.title).toBe('Job'); // untouched
  });

  it('a write whose expected version matches the stored version succeeds and advances the version by exactly 1', async () => {
    await writeProjectWithVersionCheck(db, project(), null);
    const committed = await writeProjectWithVersionCheck(db, project({ title: 'Edited' }), 1);
    expect(committed).toBe(2);
    const stored = await readOne<Project>(db, STORES.projects, 'p1');
    expect(stored?.title).toBe('Edited');
    expect(stored?.version).toBe(2);
  });

  it('REGRESSION: two saves that land in the exact same millisecond (identical updatedAt) still conflict correctly, because the check is version-number-based, not timestamp-based', async () => {
    await writeProjectWithVersionCheck(db, project(), null); // version 1

    // Both "tabs" believe version 1 is current, and both stamp the SAME
    // updatedAt — a timestamp-only check (the old implementation) cannot
    // tell these apart at all; a version-number check can and must.
    const fromTabA = project({ title: 'Tab A', updatedAt: SAME_TIMESTAMP });
    await writeProjectWithVersionCheck(db, fromTabA, 1); // succeeds, becomes version 2

    const fromTabB = project({ title: 'Tab B', updatedAt: SAME_TIMESTAMP }); // identical timestamp to tab A's write
    await expect(writeProjectWithVersionCheck(db, fromTabB, 1)).rejects.toBeInstanceOf(ConflictError);

    const stored = await readOne<Project>(db, STORES.projects, 'p1');
    expect(stored?.title).toBe('Tab A'); // tab B's conflicting write never landed
    expect(stored?.version).toBe(2);
  });

  it('a stale write (expected version behind the stored one) is rejected with a ConflictError, and the stored record is untouched', async () => {
    await writeProjectWithVersionCheck(db, project(), null);
    await writeProjectWithVersionCheck(db, project({ title: 'Edited in tab A' }), 1); // now version 2

    // Tab B still thinks version 1 is current.
    await expect(writeProjectWithVersionCheck(db, project({ title: 'Edited in tab B' }), 1)).rejects.toBeInstanceOf(ConflictError);

    const stored = await readOne<Project>(db, STORES.projects, 'p1');
    expect(stored?.title).toBe('Edited in tab A');
  });

  it('a stale save cannot silently recreate a project deleted by another tab', async () => {
    await writeProjectWithVersionCheck(db, project(), null); // version 1
    await import('../../src/storage/db').then(({ deleteOne }) => deleteOne(db, STORES.projects, 'p1'));

    // A stale writer still holding version 1 tries to save — the record is
    // gone entirely now, which must be a conflict, not a silent recreate.
    await expect(writeProjectWithVersionCheck(db, project({ title: 'Stale resurrect attempt' }), 1)).rejects.toBeInstanceOf(ConflictError);
    expect(await readOne<Project>(db, STORES.projects, 'p1')).toBeUndefined();
  });

  it('a ConflictError carries the current stored record so the caller can offer reload or save-as-copy', async () => {
    await writeProjectWithVersionCheck(db, project(), null);
    await writeProjectWithVersionCheck(db, project({ title: 'Changed elsewhere' }), 1);

    try {
      await writeProjectWithVersionCheck(db, project({ title: 'My unsaved edit' }), 1);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).currentRecord).toMatchObject({ title: 'Changed elsewhere', version: 2 });
    }
  });

  it('a failed save leaves the previously committed state completely intact (no partial write)', async () => {
    await writeProjectWithVersionCheck(db, project({ title: 'Original' }), null);
    await expect(writeProjectWithVersionCheck(db, project({ title: 'Rejected edit' }), 99)).rejects.toBeInstanceOf(ConflictError);
    const stored = await readOne<Project>(db, STORES.projects, 'p1');
    expect(stored?.title).toBe('Original');
    expect(stored?.version).toBe(1);
  });
});
