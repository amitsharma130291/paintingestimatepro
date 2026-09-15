// Thin persistence facade for the Pro app island — wraps storage/db.ts so
// the UI component doesn't touch IndexedDB directly.
import { openAppDb, writeAll, writeProjectWithVersionCheck, writeImportedBackup, writeReplaceAllBackup, readAppSnapshot, deleteOne, STORES, type AppSnapshot } from '../../../storage/db';
import type { BusinessSettings, PaintVariant, OtherMaterial, ServiceDefinition, Project, ImportProvenanceRecord } from '../../../domain/entities';
import { defaultIdSource } from '../../../domain/ids';

export const ids = defaultIdSource;

export async function loadSnapshot(): Promise<AppSnapshot> {
  const db = await openAppDb();
  try {
    return await readAppSnapshot(db);
  } finally {
    db.close();
  }
}

export async function saveBusinessSettings(settings: BusinessSettings): Promise<void> {
  const db = await openAppDb();
  try {
    await writeAll(db, [{ store: STORES.businessSettings, records: [settings] }]);
  } finally {
    db.close();
  }
}

export async function savePaintVariants(variants: PaintVariant[]): Promise<void> {
  const db = await openAppDb();
  try {
    await writeAll(db, [{ store: STORES.paintVariants, records: variants }]);
  } finally {
    db.close();
  }
}

export async function saveProjects(projects: Project[]): Promise<void> {
  const db = await openAppDb();
  try {
    await writeAll(db, [{ store: STORES.projects, records: projects }]);
  } finally {
    db.close();
  }
}

/** Independent-review R08: Price Book Health now persists real service
 * definitions (previously nothing in the UI ever wrote to this store at
 * all). */
export async function saveServiceDefinition(service: ServiceDefinition): Promise<void> {
  const db = await openAppDb();
  try {
    await writeAll(db, [{ store: STORES.serviceDefinitions, records: [service] }]);
  } finally {
    db.close();
  }
}

export async function deleteServiceDefinition(id: string): Promise<void> {
  const db = await openAppDb();
  try {
    await deleteOne(db, STORES.serviceDefinitions, id);
  } finally {
    db.close();
  }
}

/** LIFE-014: a Project record embeds its own revisions and actualReviews
 * (entities.ts) rather than spreading them across separate stores, so a
 * single `deleteOne` on the projects store is already an atomic,
 * project-scoped deletion -- it can never partially remove a project's
 * own history, and it can never touch any OTHER project's records. The
 * "clear destructive confirmation" half of the hardening gate lives in
 * the caller (ProApp.tsx), which must not call this without first getting
 * an explicit, unambiguous confirm from the user. */
export async function deleteProject(id: string): Promise<void> {
  const db = await openAppDb();
  try {
    await deleteOne(db, STORES.projects, id);
  } finally {
    db.close();
  }
}

/** Commits a confirmed restore-merge or import-as-copies backup import —
 * every touched record type atomically in one transaction, with each
 * project's write version-checked against its current stored state
 * (items 7/8). Throws `ConflictError` if a project changed elsewhere
 * since the import was previewed. */
export async function saveImportedBackup(data: {
  businessSettings?: BusinessSettings;
  paintVariants?: PaintVariant[];
  otherMaterials?: OtherMaterial[];
  serviceDefinitions?: ServiceDefinition[];
  projects: { project: Project; expectedVersion: number | null }[];
  provenance?: ImportProvenanceRecord[];
}): Promise<{ committedProjectVersions: Map<string, number> }> {
  const db = await openAppDb();
  try {
    return await writeImportedBackup(db, data);
  } finally {
    db.close();
  }
}

/** Commits a confirmed "replace all" import — every store (including the
 * business-settings singleton) wiped and replaced with the imported
 * file's own content atomically (item 7). No per-project version CHECK
 * (the explicit confirmation + required pre-import backup are this
 * mode's safety net, per DATA_CONTRACT.md), but every imported project's
 * version is still re-stamped from the shared global counter and
 * returned here so the caller can update its own in-memory baseline
 * (independent-review R04). */
export async function saveReplaceAllBackup(data: {
  businessSettings: BusinessSettings;
  paintVariants: PaintVariant[];
  otherMaterials: OtherMaterial[];
  serviceDefinitions: ServiceDefinition[];
  projects: Project[];
  provenance: ImportProvenanceRecord[];
}): Promise<{ committedProjectVersions: Map<string, number> }> {
  const db = await openAppDb();
  try {
    return await writeReplaceAllBackup(db, data);
  } finally {
    db.close();
  }
}

/** Version-checked single-project save (task item 6: multi-tab conflict
 * policy via a real monotonic version integer, not a timestamp). Throws
 * `ConflictError` (re-exported by storage/db) if another save landed
 * first — the caller's in-memory edit is untouched by that rejection, so
 * it can offer reload-or-save-as-copy. Returns the version actually
 * committed, for the caller to remember as its new baseline. */
export async function saveProjectSafely(project: Project, expectedVersion: number | null): Promise<number> {
  const db = await openAppDb();
  try {
    return await writeProjectWithVersionCheck(db, project, expectedVersion);
  } finally {
    db.close();
  }
}
