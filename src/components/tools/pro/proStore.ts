// Thin persistence facade for the Pro app island — wraps storage/db.ts so
// the UI component doesn't touch IndexedDB directly.
import { openAppDb, writeAll, readAppSnapshot, STORES, type AppSnapshot } from '../../../storage/db';
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
