// V5-03: an existing pre-v3 database's version tokens must never be
// reissued after the upgrade to the shared global counter (src/storage/db.ts
// meta store). Exercises multiple pre-existing projects at different
// versions, then normal saves AND every import write path afterward, per
// the independent review's explicit request not to restrict verification
// to a single project or a freshly-created database.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { openAppDb, writeProjectWithVersionCheck, writeImportedBackup, ConflictError, STORES } from '../../src/storage/db';
import type { Project } from '../../src/domain/entities';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());

function makeProject(id: string, version: number, title = 'Legacy project'): Project {
  const now = '2026-01-01T00:00:00.000Z';
  return { id, title, revisions: [], activeRevisionId: '', actualReviews: [], createdAt: now, updatedAt: now, version };
}

async function seedPreV3Database(projects: Project[]): Promise<void> {
  const old = await openDB('painting-estimate-pro', 2, {
    upgrade(db) {
      for (const s of Object.values(STORES).filter((s) => s !== 'meta')) {
        db.createObjectStore(s, { keyPath: s === 'importProvenance' ? 'copiedProjectId' : 'id' });
      }
    },
  });
  for (const p of projects) await old.put('projects', p);
  old.close();
}

describe('V5-03: v2-to-v3 upgrade with SEVERAL existing projects at different versions', () => {
  it('EACH of several legacy projects independently: a correct post-upgrade edit succeeds, then a second edit still expecting the OLD legacy version conflicts', async () => {
    await seedPreV3Database([makeProject('p1', 1), makeProject('p2', 5), makeProject('p3', 12)]);
    const db = await openAppDb();
    try {
      for (const [id, legacyVersion] of [['p1', 1], ['p2', 5], ['p3', 12]] as const) {
        const firstEdit = await writeProjectWithVersionCheck(db, { ...makeProject(id, legacyVersion), title: `${id} edited after upgrade` }, legacyVersion);
        expect(firstEdit).toBeGreaterThan(legacyVersion); // the token strictly advanced, never reused the legacy number
        await expect(
          writeProjectWithVersionCheck(db, { ...makeProject(id, legacyVersion), title: `stale ${id} edit` }, legacyVersion)
        ).rejects.toThrow(ConflictError); // a second editor still expecting the OLD legacy version must now conflict
      }
    } finally {
      db.close();
    }
  });

  it('a correctly-reloaded (current-version) save on a legacy project still succeeds after upgrade', async () => {
    await seedPreV3Database([makeProject('p1', 1), makeProject('p2', 5)]);
    const db = await openAppDb();
    try {
      const committed = await writeProjectWithVersionCheck(db, { ...makeProject('p2', 5), title: 'p2 correctly edited' }, 5);
      expect(committed).toBeGreaterThan(5); // strictly advances past every legacy version, not just its own
    } finally {
      db.close();
    }
  });

  it('a post-upgrade IMPORT write also advances strictly past every pre-existing legacy version', async () => {
    await seedPreV3Database([makeProject('p1', 1), makeProject('p2', 20)]);
    const db = await openAppDb();
    try {
      const incoming = makeProject('p-new', 1, 'Freshly imported project'); // the imported file's OWN version field is irrelevant; the store re-stamps it
      const { committedProjectVersions } = await writeImportedBackup(db, { projects: [{ project: incoming, expectedVersion: null }] });
      expect(committedProjectVersions.get('p-new')).toBeGreaterThan(20);
    } finally {
      db.close();
    }
  });

  it('a brand-new (never-existed-before) database still starts its counter at 1, unaffected by this seeding logic', async () => {
    const db = await openAppDb();
    try {
      const committed = await writeProjectWithVersionCheck(db, makeProject('fresh', 1), null);
      expect(committed).toBe(1);
    } finally {
      db.close();
    }
  });
});
