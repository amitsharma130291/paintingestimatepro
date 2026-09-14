// Emulator-backed (fake-indexeddb) integration tests for task item 5's
// multi-tab conflict policy: version each persisted project, check the
// version INSIDE the write transaction, reject a stale write with a
// conflict rather than silently overwriting, and never lose the rejected
// writer's edits (the caller still holds them in memory to reload or
// save-as-copy). Written before writeProjectWithVersionCheck exists.
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

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1', title: 'Job', revisions: [], activeRevisionId: 'r1', actualReviews: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
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

  it('a brand-new project (no prior version known) writes without a conflict check', async () => {
    await writeProjectWithVersionCheck(db, project(), null);
    const stored = await readOne<Project>(db, STORES.projects, 'p1');
    expect(stored?.title).toBe('Job');
  });

  it('a write whose expected version matches the stored record succeeds and advances updatedAt', async () => {
    const v1 = project({ updatedAt: '2026-01-01T00:00:00.000Z' });
    await writeProjectWithVersionCheck(db, v1, null);
    const v2 = { ...v1, title: 'Job (edited)', updatedAt: '2026-01-01T00:05:00.000Z' };
    await writeProjectWithVersionCheck(db, v2, v1.updatedAt);
    const stored = await readOne<Project>(db, STORES.projects, 'p1');
    expect(stored?.title).toBe('Job (edited)');
  });

  it('a stale write (expected version no longer matches what is stored) is rejected with a ConflictError, and the stored record is untouched', async () => {
    const v1 = project({ updatedAt: '2026-01-01T00:00:00.000Z' });
    await writeProjectWithVersionCheck(db, v1, null);

    // Tab A saves an edit first.
    const fromTabA = { ...v1, title: 'Edited in tab A', updatedAt: '2026-01-01T00:05:00.000Z' };
    await writeProjectWithVersionCheck(db, fromTabA, v1.updatedAt);

    // Tab B still thinks the original v1.updatedAt is current and tries to save its own edit.
    const fromTabB = { ...v1, title: 'Edited in tab B', updatedAt: '2026-01-01T00:06:00.000Z' };
    await expect(writeProjectWithVersionCheck(db, fromTabB, v1.updatedAt)).rejects.toBeInstanceOf(ConflictError);

    // Tab A's committed edit survives — tab B's conflicting write never landed.
    const stored = await readOne<Project>(db, STORES.projects, 'p1');
    expect(stored?.title).toBe('Edited in tab A');
  });

  it('a ConflictError carries the current stored record so the caller can offer reload or save-as-copy', async () => {
    const v1 = project({ updatedAt: '2026-01-01T00:00:00.000Z' });
    await writeProjectWithVersionCheck(db, v1, null);
    const somewhereElse = { ...v1, title: 'Changed elsewhere', updatedAt: '2026-01-01T00:05:00.000Z' };
    await writeProjectWithVersionCheck(db, somewhereElse, v1.updatedAt);

    try {
      await writeProjectWithVersionCheck(db, { ...v1, title: 'My unsaved edit' }, v1.updatedAt);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).currentRecord).toMatchObject({ title: 'Changed elsewhere' });
    }
  });
});
