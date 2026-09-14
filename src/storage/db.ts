import { openDB, type IDBPDatabase } from 'idb';
import type { BusinessSettings, PaintVariant, OtherMaterial, ServiceDefinition, Project } from '../domain/entities';

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
const DB_VERSION = 1;

export const STORES = {
  businessSettings: 'businessSettings',
  paintVariants: 'paintVariants',
  otherMaterials: 'otherMaterials',
  serviceDefinitions: 'serviceDefinitions',
  projects: 'projects',
} as const;

export async function openAppDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORES.businessSettings)) db.createObjectStore(STORES.businessSettings, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.paintVariants)) db.createObjectStore(STORES.paintVariants, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.otherMaterials)) db.createObjectStore(STORES.otherMaterials, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.serviceDefinitions)) db.createObjectStore(STORES.serviceDefinitions, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.projects)) db.createObjectStore(STORES.projects, { keyPath: 'id' });
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
}

export async function readAppSnapshot(db: IDBPDatabase): Promise<AppSnapshot> {
  const [businessSettings, paintVariants, otherMaterials, serviceDefinitions, projects] = await Promise.all([
    readAll<BusinessSettings>(db, STORES.businessSettings),
    readAll<PaintVariant>(db, STORES.paintVariants),
    readAll<OtherMaterial>(db, STORES.otherMaterials),
    readAll<ServiceDefinition>(db, STORES.serviceDefinitions),
    readAll<Project>(db, STORES.projects),
  ]);
  return { businessSettings, paintVariants, otherMaterials, serviceDefinitions, projects };
}
