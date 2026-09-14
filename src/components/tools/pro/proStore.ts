// Thin persistence facade for the Pro app island — wraps storage/db.ts so
// the UI component doesn't touch IndexedDB directly.
import { openAppDb, writeAll, writeProjectWithVersionCheck, readAppSnapshot, STORES, type AppSnapshot } from '../../../storage/db';
import type { BusinessSettings, PaintVariant, Project } from '../../../domain/entities';
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
