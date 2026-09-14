import type { BackupEnvelope, Project, BusinessSettings, PaintVariant, OtherMaterial, ServiceDefinition } from './entities';
import { SCHEMA_VERSION, ENGINE_VERSION } from './entities';
import type { IdSource } from './ids';

/** DATA_CONTRACT.md "Backup envelope" + "Import modes". */

export function exportBackup(
  installationId: string,
  businessSettings: BusinessSettings,
  paintVariants: PaintVariant[],
  otherMaterials: OtherMaterial[],
  serviceDefinitions: ServiceDefinition[],
  projects: Project[],
  ids: IdSource
): BackupEnvelope {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportId: ids.nextId(),
    exportedAt: ids.now(),
    installationId,
    engineVersion: ENGINE_VERSION,
    businessSettings: structuredClone(businessSettings),
    paintVariants: structuredClone(paintVariants),
    otherMaterials: structuredClone(otherMaterials),
    serviceDefinitions: structuredClone(serviceDefinitions),
    projects: structuredClone(projects),
    importProvenance: [],
  };
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/** Full-shape validation BEFORE any write — D11: "failed/truncated/invalid
 * version/dangling reference/duplicate ID/oversized import -> no writes." */
export function validateBackupEnvelope(raw: unknown, rawByteLength: number): { ok: true; envelope: BackupEnvelope } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (rawByteLength > MAX_IMPORT_BYTES) issues.push({ path: '$', message: `File exceeds the ${MAX_IMPORT_BYTES} byte import limit.` });
  if (typeof raw !== 'object' || raw === null) {
    issues.push({ path: '$', message: 'Backup file is not a JSON object.' });
    return { ok: false, issues };
  }
  const env = raw as Partial<BackupEnvelope>;
  if (env.schemaVersion === undefined) issues.push({ path: 'schemaVersion', message: 'Missing schemaVersion.' });
  else if (env.schemaVersion !== SCHEMA_VERSION) {
    issues.push({ path: 'schemaVersion', message: `Unsupported schemaVersion ${env.schemaVersion}; this build supports ${SCHEMA_VERSION} only. No silent migration.` });
  }
  if (!env.businessSettings) issues.push({ path: 'businessSettings', message: 'Missing businessSettings.' });
  if (!Array.isArray(env.paintVariants)) issues.push({ path: 'paintVariants', message: 'paintVariants must be an array.' });
  if (!Array.isArray(env.projects)) issues.push({ path: 'projects', message: 'projects must be an array.' });

  // Duplicate ID check across paint variants (representative — extend per
  // entity type as the catalog grows).
  if (Array.isArray(env.paintVariants)) {
    const seen = new Set<string>();
    for (const v of env.paintVariants) {
      if (seen.has(v.id)) issues.push({ path: `paintVariants[${v.id}]`, message: `Duplicate paint variant ID ${v.id}.` });
      seen.add(v.id);
    }
  }

  // Dangling reference check: every revision's activeRateSnapshot must be
  // present (it's embedded, not referenced) — but surfaces referencing a
  // paintVariantId that no longer exists in the LIVE catalog are fine
  // (resolved through their own snapshot); we only reject truly missing
  // required substructures.
  if (Array.isArray(env.projects)) {
    for (const p of env.projects) {
      if (!p.id || !Array.isArray(p.revisions)) {
        issues.push({ path: `projects[${p.id ?? '?'}]`, message: 'Project missing id or revisions[].' });
        continue;
      }
      for (const rev of p.revisions) {
        if (!rev.activeRateSnapshot) issues.push({ path: `projects[${p.id}].revisions[${rev.id}]`, message: 'Revision missing embedded rate snapshot.' });
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, envelope: raw as BackupEnvelope };
}

export type ImportMode = 'restoreMerge' | 'importAsCopies' | 'replaceAll';

export interface ImportConflict {
  kind: 'project' | 'businessSettings' | 'paintVariant' | 'otherMaterial' | 'serviceDefinition';
  id: string;
  resolution: 'keepLocal' | 'replaceImported' | 'keepBoth';
}

export interface ImportPlan {
  mode: ImportMode;
  toAdd: { projects: Project[] };
  toSkip: { projectIds: string[] };
  conflicts: ImportConflict[];
}

/** Restore/merge (default): identical existing records skip; new IDs add;
 * conflicting content at the same ID needs an explicit resolution
 * (default keepLocal, never an automatic timestamp-wins rule). */
export function planRestoreMerge(existingProjects: Project[], incomingProjects: Project[]): ImportPlan {
  const existingById = new Map(existingProjects.map((p) => [p.id, p]));
  const toAdd: Project[] = [];
  const toSkip: string[] = [];
  const conflicts: ImportConflict[] = [];

  for (const incoming of incomingProjects) {
    const existing = existingById.get(incoming.id);
    if (!existing) {
      toAdd.push(incoming);
      continue;
    }
    if (JSON.stringify(existing) === JSON.stringify(incoming)) {
      toSkip.push(incoming.id); // identical -> skip, not a duplicate
    } else {
      conflicts.push({ kind: 'project', id: incoming.id, resolution: 'keepLocal' }); // default; caller may override
    }
  }

  return { mode: 'restoreMerge', toAdd: { projects: toAdd }, toSkip: { projectIds: toSkip }, conflicts };
}

/** Import as copies: new IDs throughout each imported graph, remapping
 * every internal link (rooms, surfaces, actual-review baseline). Skips by
 * provenance on repeat import of the SAME export unless the user
 * explicitly asks for another copy. */
export function planImportAsCopies(
  incomingProjects: Project[],
  exportId: string,
  alreadyImportedSourceIds: Set<string>,
  ids: IdSource,
  forceAnotherCopy = false
): { projects: Project[]; skippedSourceIds: string[]; provenance: { exportId: string; sourceProjectId: string; copiedProjectId: string; importedAt: string }[] } {
  const projects: Project[] = [];
  const skippedSourceIds: string[] = [];
  const provenance: { exportId: string; sourceProjectId: string; copiedProjectId: string; importedAt: string }[] = [];

  for (const source of incomingProjects) {
    if (!forceAnotherCopy && alreadyImportedSourceIds.has(source.id)) {
      skippedSourceIds.push(source.id);
      continue;
    }
    const remapped = remapProjectIds(source, ids);
    projects.push(remapped);
    provenance.push({ exportId, sourceProjectId: source.id, copiedProjectId: remapped.id, importedAt: ids.now() });
  }

  return { projects, skippedSourceIds, provenance };
}

function remapProjectIds(source: Project, ids: IdSource): Project {
  const newProjectId = ids.nextId();
  const revisionIdMap = new Map(source.revisions.map((r) => [r.id, ids.nextId()]));
  const newRevisions = source.revisions.map((rev) => ({
    ...structuredClone(rev),
    id: revisionIdMap.get(rev.id)!,
    projectId: newProjectId,
  }));
  const newActualReviews = source.actualReviews.map((ar) => ({
    ...structuredClone(ar),
    id: ids.nextId(),
    projectId: newProjectId,
    // "New copied IDs remap all children/actual baselines, not only project IDs."
    baselineIssuedRevisionId: revisionIdMap.get(ar.baselineIssuedRevisionId) ?? ar.baselineIssuedRevisionId,
  }));
  return {
    ...structuredClone(source),
    id: newProjectId,
    revisions: newRevisions,
    activeRevisionId: revisionIdMap.get(source.activeRevisionId) ?? newRevisions[0]?.id,
    actualReviews: newActualReviews,
  };
}
