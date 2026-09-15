import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type { BusinessSettings, PaintVariant, OtherMaterial, ServiceDefinition, Project, ImportProvenanceRecord } from '../domain/entities';

/**
 * DATA_CONTRACT.md: "Use transactional local persistence (e.g. IndexedDB)
 * for multi-record operations. On quota/storage error, leave previous
 * committed state intact... Never claim 'saved' on failure." IndexedDB
 * transactions are atomic by the platform's own guarantee — a `readwrite`
 * transaction either commits every request in it or aborts every request
 * in it; we rely on that native guarantee rather than hand-rolling a
 * two-phase commit.
 */

const DB_NAME = 'painting-estimate-pro';
// v3 adds the meta store (independent-review R04) — a single global,
// monotonically increasing version counter shared by EVERY project write
// (normal saves, merge imports, AND replace-all), so a version number can
// never repeat across the database's whole history. Without this, a
// per-project counter that restarts at 1 after a replace-all creates a
// real ABA hazard: a stale tab holding "version 1" of the OLD project can
// coincidentally match a freshly-imported DIFFERENT project that also
// happens to be at version 1, and its write would wrongly succeed. The
// idempotent `contains()` guards mean an existing v1/v2 database only
// gains the one new store on upgrade.
const DB_VERSION = 3;

export const STORES = {
  businessSettings: 'businessSettings',
  paintVariants: 'paintVariants',
  otherMaterials: 'otherMaterials',
  serviceDefinitions: 'serviceDefinitions',
  projects: 'projects',
  importProvenance: 'importProvenance',
  meta: 'meta',
} as const;

const VERSION_COUNTER_KEY = 'projectVersionCounter';

export async function openAppDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    async upgrade(db, _oldVersion, _newVersion, transaction) {
      if (!db.objectStoreNames.contains(STORES.businessSettings)) db.createObjectStore(STORES.businessSettings, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.paintVariants)) db.createObjectStore(STORES.paintVariants, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.otherMaterials)) db.createObjectStore(STORES.otherMaterials, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.serviceDefinitions)) db.createObjectStore(STORES.serviceDefinitions, { keyPath: 'id' });
      const projectsStoreExistedBefore = db.objectStoreNames.contains(STORES.projects);
      if (!projectsStoreExistedBefore) db.createObjectStore(STORES.projects, { keyPath: 'id' });
      // Keyed by copiedProjectId (always unique — one provenance record per
      // successfully-copied project) rather than a compound (exportId,
      // sourceProjectId) key; "already imported this export" lookups read
      // the whole (small, infrequent) store and filter in JS.
      if (!db.objectStoreNames.contains(STORES.importProvenance)) db.createObjectStore(STORES.importProvenance, { keyPath: 'copiedProjectId' });
      const metaStoreIsNew = !db.objectStoreNames.contains(STORES.meta);
      if (metaStoreIsNew) db.createObjectStore(STORES.meta, { keyPath: 'id' });

      // V5-03: an existing pre-v3 database (real projects saved under the
      // OLD per-project version scheme) upgrading to v3 got a brand-new,
      // EMPTY meta store, so the global counter restarted at 0/1 --
      // coinciding with legacy version numbers already stored on real
      // projects. The very first post-upgrade save could then reissue a
      // version number a stale pre-upgrade editor was already holding,
      // recreating exactly the ABA hazard R04 fixed, just via the upgrade
      // path instead of replace-all. Seed the counter above every version
      // number already present in this database before any new write ever
      // reads it, so no future-issued token can coincide with one already
      // committed under the old scheme.
      if (metaStoreIsNew && projectsStoreExistedBefore) {
        const existingProjects = (await transaction.objectStore(STORES.projects).getAll()) as { version?: number }[];
        const maxExistingVersion = existingProjects.reduce((max, p) => Math.max(max, p.version ?? 0), 0);
        if (maxExistingVersion > 0) {
          await transaction.objectStore(STORES.meta).put({ id: VERSION_COUNTER_KEY, value: maxExistingVersion });
        }
      }
    },
  });
}

/** Reads-increments-writes the single global project-version counter
 * WITHIN the caller's own transaction (the transaction must include
 * `STORES.meta`) and returns the freshly-reserved version number. Every
 * project write in this module goes through this — never a per-project
 * `(current?.version ?? 0) + 1`, which is exactly the scheme that let a
 * post-replace-all version number collide with a pre-replace one. */
async function nextGlobalProjectVersion(tx: IDBPTransaction<unknown, string[], 'readwrite'>): Promise<number> {
  const metaOs = tx.objectStore(STORES.meta);
  const current = (await metaOs.get(VERSION_COUNTER_KEY)) as { id: string; value: number } | undefined;
  const next = (current?.value ?? 0) + 1;
  await metaOs.put({ id: VERSION_COUNTER_KEY, value: next });
  return next;
}

export class SaveFailedError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'SaveFailedError';
  }
}

/** Writes every (store, records[]) pair inside ONE readwrite transaction —
 * either all of it commits or none of it does. Never resolves as
 * "succeeded" unless `tx.done` actually resolved. */
export async function writeAll(db: IDBPDatabase, writes: { store: string; records: { id: string }[] }[]): Promise<void> {
  const storeNames = writes.map((w) => w.store);
  const tx = db.transaction(storeNames, 'readwrite');
  // `tx.done` can reject independently of the loop below — attach a catch
  // handler to it immediately so that rejection is never left unhandled,
  // regardless of which path below actually reports the failure.
  const settled = tx.done.catch((err) => err as unknown);

  try {
    for (const { store, records } of writes) {
      const os = tx.objectStore(store);
      for (const record of records) await os.put(record);
    }
    await tx.done;
  } catch (err) {
    // Do not rely solely on IndexedDB's implicit "unhandled request error
    // aborts the transaction" behavior — explicitly abort so every write
    // queued in this same transaction is guaranteed to roll back together,
    // not just the one request that happened to fail.
    try {
      tx.abort();
    } catch {
      /* already aborted/finished */
    }
    await settled;
    throw new SaveFailedError('Save failed — your previous data was not changed.', err);
  }
}

export class ConflictError extends Error {
  constructor(message: string, public currentRecord: unknown) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * Optimistic-concurrency write for a single project (task item 6: "Replace
 * timestamp-only conflict detection with a reliable version token... checked
 * and updated within the same database transaction"). Uses a real
 * monotonically-increasing integer (`Project.version`), NOT `updatedAt` —
 * an ISO-timestamp comparison cannot distinguish two saves that land in the
 * same millisecond, which a real multi-tab race can absolutely produce.
 *
 * `expectedVersion === null` asserts "this id must not already exist" (a
 * true create) — if a record with this id is already there, that is
 * itself a conflict, not silently skipped. Any other value asserts
 * "the currently-stored version must equal exactly this" — if the record
 * is missing entirely (e.g. deleted by another tab) that is ALSO a
 * conflict, not treated as license to recreate it. On success the write
 * always commits the record with `version` drawn from the single GLOBAL
 * counter (`nextGlobalProjectVersion` — see its own doc comment for why a
 * per-project counter is unsafe across a replace-all), ignoring whatever
 * `project.version` the caller happened to pass in, so the version
 * sequence can never be forged, skipped, or coincidentally repeated from
 * outside this function. Returns the version actually committed.
 */
export async function writeProjectWithVersionCheck(db: IDBPDatabase, project: Project, expectedVersion: number | null): Promise<number> {
  const tx = db.transaction([STORES.projects, STORES.meta], 'readwrite');
  const settled = tx.done.catch((err) => err as unknown);
  try {
    const os = tx.objectStore(STORES.projects);
    const current = (await os.get(project.id)) as Project | undefined;

    if (expectedVersion === null && current) {
      throw new ConflictError(`A project with id "${project.id}" already exists.`, current);
    }
    if (expectedVersion !== null && !current) {
      throw new ConflictError('This project no longer exists — it may have been deleted elsewhere.', undefined);
    }
    if (expectedVersion !== null && current && current.version !== expectedVersion) {
      throw new ConflictError(`This project was changed elsewhere (now at version ${current.version}). Reload or save as a copy instead of overwriting.`, current);
    }

    const nextVersion = await nextGlobalProjectVersion(tx);
    await os.put({ ...project, version: nextVersion });
    await tx.done;
    return nextVersion;
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* already aborted/finished */
    }
    await settled;
    if (err instanceof ConflictError) throw err;
    throw new SaveFailedError('Save failed — your previous data was not changed.', err);
  }
}

/**
 * Commits a backup import — every touched record type in ONE atomic
 * transaction (item 7: "confirmed imports must commit atomically," across
 * every supported record type, not just projects), with each project's
 * write version-checked against its CURRENT stored state inside that same
 * transaction (item 8: "validate the import plan's expected versions...
 * within the same transaction that performs the write").
 *
 * Each entry in `projects` carries the `expectedVersion` captured when the
 * import PREVIEW was computed — `null` for a brand-new project (add, or a
 * "keep both" copy with a fresh ID), or the specific version number seen
 * for a "replace imported" conflict resolution. If ANY project's current
 * stored version no longer matches (edited/deleted by another tab after
 * the preview, before this confirm), the ENTIRE transaction aborts and a
 * `ConflictError` is thrown — a stale import can never partially land or
 * silently overwrite newer work. `businessSettings`/`paintVariants`/
 * `otherMaterials`/`serviceDefinitions` are not individually
 * version-tracked in this data model (only `Project` is), so those are
 * written unconditionally once the whole transaction is known to be safe
 * to commit (i.e. no project-level conflict was found).
 */
export async function writeImportedBackup(
  db: IDBPDatabase,
  writes: {
    businessSettings?: BusinessSettings;
    paintVariants?: PaintVariant[];
    otherMaterials?: OtherMaterial[];
    serviceDefinitions?: ServiceDefinition[];
    projects: { project: Project; expectedVersion: number | null }[];
    provenance?: ImportProvenanceRecord[];
  }
): Promise<{ committedProjectVersions: Map<string, number> }> {
  const storeNames: string[] = [STORES.projects, STORES.meta];
  if (writes.businessSettings) storeNames.push(STORES.businessSettings);
  if (writes.paintVariants) storeNames.push(STORES.paintVariants);
  if (writes.otherMaterials) storeNames.push(STORES.otherMaterials);
  if (writes.serviceDefinitions) storeNames.push(STORES.serviceDefinitions);
  if (writes.provenance?.length) storeNames.push(STORES.importProvenance);

  const tx = db.transaction(storeNames, 'readwrite');
  const settled = tx.done.catch((err) => err as unknown);
  try {
    const projectsOs = tx.objectStore(STORES.projects);
    const committedProjectVersions = new Map<string, number>();

    for (const { project, expectedVersion } of writes.projects) {
      const current = (await projectsOs.get(project.id)) as Project | undefined;
      if (expectedVersion === null && current) {
        throw new ConflictError(`A project with id "${project.id}" already exists.`, current);
      }
      if (expectedVersion !== null && !current) {
        throw new ConflictError('A project targeted by this import no longer exists — it may have been deleted elsewhere. Refresh the import preview and try again.', undefined);
      }
      if (expectedVersion !== null && current && current.version !== expectedVersion) {
        throw new ConflictError(`"${project.title}" was changed elsewhere since you previewed this import (now at version ${current.version}). Refresh the import preview and try again.`, current);
      }
      const nextVersion = await nextGlobalProjectVersion(tx);
      await projectsOs.put({ ...project, version: nextVersion });
      committedProjectVersions.set(project.id, nextVersion);
    }

    if (writes.businessSettings) await tx.objectStore(STORES.businessSettings).put(writes.businessSettings);
    if (writes.paintVariants) for (const v of writes.paintVariants) await tx.objectStore(STORES.paintVariants).put(v);
    if (writes.otherMaterials) for (const m of writes.otherMaterials) await tx.objectStore(STORES.otherMaterials).put(m);
    if (writes.serviceDefinitions) for (const s of writes.serviceDefinitions) await tx.objectStore(STORES.serviceDefinitions).put(s);
    if (writes.provenance) for (const p of writes.provenance) await tx.objectStore(STORES.importProvenance).put(p);

    await tx.done;
    return { committedProjectVersions };
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* already aborted/finished */
    }
    await settled;
    if (err instanceof ConflictError) throw err;
    throw new SaveFailedError('Import failed — your previous data was not changed.', err);
  }
}

/**
 * "Replace all" import mode (DATA_CONTRACT.md: "explicit confirmation,
 * downloadable pre-import backup, atomic replacement after full
 * validation"). Every store — including `businessSettings`, a singleton
 * that a stray `.put()` alone would leave duplicated rather than replaced
 * (independent-review R04) — is cleared and replaced with the imported
 * file's own content in one transaction, so a failure partway through
 * never leaves a half-wiped, half-imported store.
 *
 * Every imported project's version is re-stamped from the single global
 * counter (never the version number the backup file itself specified) —
 * independent-review R04: a per-record version that resets after a
 * replace creates a real ABA hazard, where a stale tab's pre-replace
 * "version 1" token can coincidentally match a freshly-imported
 * DIFFERENT project that also claims to be version 1, letting the stale
 * write wrongly succeed and silently overwrite the just-restored data.
 * Drawing from the same global sequence every other project write uses
 * guarantees the post-replace version was never seen before, so any
 * pre-replace token is guaranteed to miss. Returns the versions actually
 * committed so the caller can update its own in-memory baseline —
 * otherwise the SAME tab's very next save after a replace-all would use
 * the stale envelope version and incorrectly conflict against its own
 * just-written data.
 */
export async function writeReplaceAllBackup(
  db: IDBPDatabase,
  data: {
    businessSettings: BusinessSettings;
    paintVariants: PaintVariant[];
    otherMaterials: OtherMaterial[];
    serviceDefinitions: ServiceDefinition[];
    projects: Project[];
    provenance: ImportProvenanceRecord[];
  }
): Promise<{ committedProjectVersions: Map<string, number> }> {
  const storeNames = [STORES.businessSettings, STORES.paintVariants, STORES.otherMaterials, STORES.serviceDefinitions, STORES.projects, STORES.importProvenance, STORES.meta];
  const tx = db.transaction(storeNames, 'readwrite');
  const settled = tx.done.catch((err) => err as unknown);
  try {
    await tx.objectStore(STORES.businessSettings).clear();
    await tx.objectStore(STORES.paintVariants).clear();
    await tx.objectStore(STORES.otherMaterials).clear();
    await tx.objectStore(STORES.serviceDefinitions).clear();
    await tx.objectStore(STORES.projects).clear();
    await tx.objectStore(STORES.importProvenance).clear();
    await tx.objectStore(STORES.businessSettings).put(data.businessSettings);
    for (const v of data.paintVariants) await tx.objectStore(STORES.paintVariants).put(v);
    for (const m of data.otherMaterials) await tx.objectStore(STORES.otherMaterials).put(m);
    for (const s of data.serviceDefinitions) await tx.objectStore(STORES.serviceDefinitions).put(s);
    const committedProjectVersions = new Map<string, number>();
    for (const p of data.projects) {
      const version = await nextGlobalProjectVersion(tx);
      await tx.objectStore(STORES.projects).put({ ...p, version });
      committedProjectVersions.set(p.id, version);
    }
    for (const rec of data.provenance) await tx.objectStore(STORES.importProvenance).put(rec);
    await tx.done;
    return { committedProjectVersions };
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* already aborted/finished */
    }
    await settled;
    throw new SaveFailedError('Replace-all import failed — your previous data was not changed.', err);
  }
}

export async function readAll<T>(db: IDBPDatabase, store: string): Promise<T[]> {
  return db.getAll(store);
}

export async function readOne<T>(db: IDBPDatabase, store: string, id: string): Promise<T | undefined> {
  return db.get(store, id);
}

export async function deleteOne(db: IDBPDatabase, store: string, id: string): Promise<void> {
  await db.delete(store, id);
}

export interface AppSnapshot {
  businessSettings: BusinessSettings[];
  paintVariants: PaintVariant[];
  otherMaterials: OtherMaterial[];
  serviceDefinitions: ServiceDefinition[];
  projects: Project[];
  importProvenance: ImportProvenanceRecord[];
}

export async function readAppSnapshot(db: IDBPDatabase): Promise<AppSnapshot> {
  const [businessSettings, paintVariants, otherMaterials, serviceDefinitions, projects, importProvenance] = await Promise.all([
    readAll<BusinessSettings>(db, STORES.businessSettings),
    readAll<PaintVariant>(db, STORES.paintVariants),
    readAll<OtherMaterial>(db, STORES.otherMaterials),
    readAll<ServiceDefinition>(db, STORES.serviceDefinitions),
    readAll<Project>(db, STORES.projects),
    readAll<ImportProvenanceRecord>(db, STORES.importProvenance),
  ]);
  return { businessSettings, paintVariants, otherMaterials, serviceDefinitions, projects, importProvenance };
}
