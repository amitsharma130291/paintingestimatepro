// BACK: backup validation, restore/merge, and import-as-copies.
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { validateBackupEnvelope, planRestoreMerge, planImportAsCopies, exportBackup } from '../../src/domain/backup';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision } from '../../src/domain/project';
import type { BusinessSettings, PaintVariant, Project } from '../../src/domain/entities';

function makeSettings(): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'settings-1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: now, updatedAt: now,
  };
}
function makeVariant(): PaintVariant {
  const now = '2026-01-01T00:00:00.000Z';
  return { id: 'paint-1', name: 'Sample White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: now, updatedAt: now };
}
function makeProject(id: string, ids: ReturnType<typeof sequentialIdSource>): Project {
  const snapshot = createSnapshot(makeSettings(), [makeVariant()], [], ids, 'rev-1');
  const revision = createDraftRevision(id, snapshot, ids);
  return { id, title: `Project ${id}`, revisions: [revision], activeRevisionId: revision.id, actualReviews: [], createdAt: ids.now(), updatedAt: ids.now() };
}

describe('BACK-D11: validation rejects before any write', () => {
  it('rejects a wrong/missing schemaVersion', () => {
    const result = validateBackupEnvelope({ schemaVersion: 1, businessSettings: {}, paintVariants: [], projects: [] }, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.path === 'schemaVersion')).toBe(true);
  });

  it('rejects an oversized file before parsing further', () => {
    const result = validateBackupEnvelope({ schemaVersion: 2, businessSettings: {}, paintVariants: [], projects: [] }, 30 * 1024 * 1024);
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate paint variant IDs', () => {
    const dup = makeVariant();
    const result = validateBackupEnvelope({ schemaVersion: 2, businessSettings: makeSettings(), paintVariants: [dup, dup], projects: [] }, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.message.includes('Duplicate'))).toBe(true);
  });

  it('rejects a project revision missing its embedded rate snapshot (dangling reference)', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    // @ts-expect-error deliberately corrupt for the test
    project.revisions[0].activeRateSnapshot = undefined;
    const result = validateBackupEnvelope({ schemaVersion: 2, businessSettings: makeSettings(), paintVariants: [], projects: [project] }, 1000);
    expect(result.ok).toBe(false);
  });

  it('accepts a well-formed envelope', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const envelope = exportBackup('install-1', makeSettings(), [makeVariant()], [], [], [project], ids);
    const result = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(result.ok).toBe(true);
  });
});

describe('BACK-D09: restore/merge — identical skip, new add, conflicting requires a choice (default keep-local)', () => {
  it('an identical existing project is skipped, not duplicated', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const plan = planRestoreMerge([project], [structuredClone(project)]);
    expect(plan.toAdd.projects).toHaveLength(0);
    expect(plan.toSkip.projectIds).toEqual(['p1']);
    expect(plan.conflicts).toHaveLength(0);
  });

  it('a brand-new project ID is added', () => {
    const ids = sequentialIdSource();
    const existing = makeProject('p1', ids);
    const incoming = makeProject('p2', ids);
    const plan = planRestoreMerge([existing], [incoming]);
    expect(plan.toAdd.projects.map((p) => p.id)).toEqual(['p2']);
  });

  it('same ID, different content -> a conflict defaulting to keep-local (never auto timestamp-wins)', () => {
    const ids = sequentialIdSource();
    const existing = makeProject('p1', ids);
    const incoming = { ...structuredClone(existing), title: 'Edited elsewhere' };
    const plan = planRestoreMerge([existing], [incoming]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].resolution).toBe('keepLocal');
  });

  it('D09 repeated identical restore -> zero duplicates on a second run', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const firstPlan = planRestoreMerge([project], [structuredClone(project)]);
    expect(firstPlan.toAdd.projects).toHaveLength(0);
    const secondPlan = planRestoreMerge([project], [structuredClone(project)]);
    expect(secondPlan.toAdd.projects).toHaveLength(0);
  });
});

describe('BACK-D10: import-as-copies — provenance-based skip, full ID remap including actual baselines', () => {
  it('remaps project/revision IDs and the actual-review baseline reference together', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const withActual: Project = {
      ...project,
      actualReviews: [{ id: 'ar-1', projectId: project.id, baselineIssuedRevisionId: project.activeRevisionId, state: 'final', materials: { confirmed: true, amount: '1' }, labor: { confirmed: true, amount: '1' }, otherExpenses: { confirmed: true, amount: '1' }, overhead: { confirmed: true, amount: '1', mode: 'baselineAllocation' }, updatedAt: ids.now() }],
    };
    const result = planImportAsCopies([withActual], 'export-1', new Set(), ids);
    expect(result.projects).toHaveLength(1);
    const copy = result.projects[0];
    expect(copy.id).not.toBe(project.id);
    expect(copy.revisions[0].id).not.toBe(project.activeRevisionId);
    // The actual review's baseline must point at the COPIED revision id, not the original.
    expect(copy.actualReviews[0].baselineIssuedRevisionId).toBe(copy.revisions[0].id);
    expect(result.provenance[0]).toMatchObject({ exportId: 'export-1', sourceProjectId: 'p1', copiedProjectId: copy.id });
  });

  it('repeat import of the same export skips by provenance unless another copy is explicitly requested', () => {
    const ids = sequentialIdSource();
    const project = makeProject('p1', ids);
    const alreadyImported = new Set(['p1']);
    const skipped = planImportAsCopies([project], 'export-1', alreadyImported, ids);
    expect(skipped.projects).toHaveLength(0);
    expect(skipped.skippedSourceIds).toEqual(['p1']);

    const forced = planImportAsCopies([project], 'export-1', alreadyImported, ids, true);
    expect(forced.projects).toHaveLength(1);
  });
});
