import { openDB, type IDBPDatabase } from 'idb';
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
// v2 adds the importProvenance store (item 6/7) — the idempotent
// `contains()` guards below mean an existing v1 database only gains the
// one new store on upgrade, and a fresh install gets all of them.
const DB_VERSION = 2;

export const STORES = {
  businessSettings: 'businessSettings',
  paintVariants: 'paintVariants',
  otherMaterials: 'otherMaterials',
  serviceDefinitions: 'serviceDefinitions',
  projects: 'projects',
  importProvenance: 'importProvenance',
} as const;

export async function openAppDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORES.businessSettings)) db.createObjectStore(STORES.businessSettings, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.paintVariants)) db.createObjectStore(STORES.paintVariants, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.otherMaterials)) db.createObjectStore(STORES.otherMaterials, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.serviceDefinitions)) db.createObjectStore(STORES.serviceDefinitions, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.projects)) db.createObjectStore(STORES.projects, { keyPath: 'id' });
      // Keyed by copiedProjectId (always unique — one provenance record per
      // successfully-copied project) rather than a compound (exportId,
      // sourceProjectId) key; "already imported this export" lookups read
      // the whole (small, infrequent) store and filter in JS.
      if (!db.objectStoreNames.contains(STORES.importProvenance)) db.createObjectStore(STORES.importProvenance, { keyPath: 'copiedProjectId' });
    },
  });
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
 * always commits the record with `version` set to `(current?.version ?? 0) + 1`,
 * ignoring whatever `project.version` the caller happened to pass in, so
 * the version sequence can never be forged or skipped from outside this
 * function. Returns the version actually committed.
 */
export async function writeProjectWithVersionCheck(db: IDBPDatabase, project: Project, expectedVersion: number | null): Promise<number> {
  const tx = db.transaction(STORES.projects, 'readwrite');
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

    const nextVersion = (current?.version ?? 0) + 1;
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
  const storeNames: string[] = [STORES.projects];
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
      const nextVersion = (current?.version ?? 0) + 1;
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
