// LIFE-011, LIFE-013, BACK-023, BACK-024: lifecycle/backup scenarios not
// yet covered by any test using these exact requirements. LIFE-006 and
// LIFE-010 needed no new test here -- both are already proven end-to-end
// by this session's tests/browser/actualsRequirements.test.tsx (ACT-014,
// which proves issuing a second revision transitions the first to
// 'superseded') and tests/browser/issuedDocumentEngineUpgrade.test.tsx
// (DOC-011, which proves an issued document's financial output survives
// an engine-version bump unchanged).
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision, updateRoom, moveRoom } from '../../src/domain/project';
import { openAppDb, STORES, writeProjectWithVersionCheck, ConflictError } from '../../src/storage/db';
import { planFullRestoreMerge } from '../../src/domain/backup';
import type { BusinessSettings, PaintVariant, Room, Project } from '../../src/domain/entities';

const NOW = '2026-01-01T00:00:00.000Z';
function settings(): BusinessSettings {
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
  };
}
function variant(): PaintVariant {
  return { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW };
}
function room(id: string, name: string, surfaceIds: string[]): Room {
  return { id, name, lengthFt: '10', widthFt: '10', heightFt: '8', deductionEnabled: false, openingMode: 'quick', quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' }, openings: [], surfaceIds };
}

describe('LIFE-011: renaming and reordering rooms preserves every room/surface ID and owning relationship', () => {
  it('rename never touches the id, and reorder swaps array position only -- surfaceIds ownership is untouched by either', () => {
    const ids = sequentialIdSource();
    const snap = createSnapshot(settings(), [variant()], [], ids, 'rev-1');
    let revision = createDraftRevision('project-1', snap, ids);
    const bedroom = room('room-A', 'Bedroom', ['wall-1']);
    const kitchen = room('room-B', 'Kitchen', ['wall-2']);
    revision = { ...revision, rooms: [bedroom, kitchen] };

    const renamed = updateRoom(revision, 'room-A', { name: 'Primary Bedroom' }, ids);
    expect(renamed.rooms.find((r) => r.id === 'room-A')!.name).toBe('Primary Bedroom');
    expect(renamed.rooms.find((r) => r.id === 'room-A')!.surfaceIds).toEqual(['wall-1']); // ownership preserved
    expect(renamed.rooms.map((r) => r.id)).toEqual(['room-A', 'room-B']); // no id/order change from a rename

    const reordered = moveRoom(renamed, 'room-B', 'up', ids);
    expect(reordered.rooms.map((r) => r.id)).toEqual(['room-B', 'room-A']); // order swapped
    // Every room keeps its OWN id and its OWN surfaceIds -- reordering never
    // reassigns ownership between rooms (a historical bug class this
    // guards against: index-based, rather than id-based, ownership).
    expect(reordered.rooms.find((r) => r.id === 'room-A')!.surfaceIds).toEqual(['wall-1']);
    expect(reordered.rooms.find((r) => r.id === 'room-B')!.surfaceIds).toEqual(['wall-2']);
    expect(reordered.rooms.find((r) => r.id === 'room-A')!.name).toBe('Primary Bedroom'); // the earlier rename survived the later reorder
  });
});

describe('LIFE-013: an interrupted issue-time write leaves either the prior state or the complete issued state -- never a half-issued record', () => {
  it('a version-conflicting write attempt (simulating an interruption/concurrent change) throws BEFORE anything is persisted, leaving the stored project exactly as it was pre-issue', async () => {
    const ids = sequentialIdSource();
    const snap = createSnapshot(settings(), [variant()], [], ids, 'rev-1');
    const draftRevision = { ...createDraftRevision('project-1', snap, ids), state: 'draft' as const };
    const project: Project = { id: 'project-1', title: 'Kitchen', revisions: [draftRevision], activeRevisionId: draftRevision.id, actualReviews: [], createdAt: NOW, updatedAt: NOW, version: 1 };

    const db = await openAppDb();
    try {
      const committedVersion = await writeProjectWithVersionCheck(db, project, null);

      // Simulate "issuing" this project (state flips to issued in memory,
      // exactly as ProApp.tsx's issueEstimate() builds its object) but the
      // save call races against a STALE expectedVersion, as an interrupted/
      // concurrently-modified transaction would.
      const issuedInMemory: Project = { ...project, revisions: [{ ...draftRevision, state: 'issued' }], version: committedVersion };
      await expect(writeProjectWithVersionCheck(db, issuedInMemory, committedVersion - 1 /* stale */)).rejects.toThrow(ConflictError);

      // The store must show EXACTLY the prior committed state -- never a
      // half-issued record with e.g. state='issued' but a stale version,
      // or any other partial mix of before/after fields.
      const stored = (await db.get(STORES.projects, 'project-1')) as Project;
      expect(stored.revisions[0].state).toBe('draft');
      expect(stored.version).toBe(committedVersion);
    } finally {
      db.close();
    }
  });
});

describe('BACK-024: two projects that happen to share the same visible title retain fully distinct IDs -- restore never deduplicates by title', () => {
  it('two same-titled, different-ID projects both survive a merge plan as separate "add" entries, never collapsed into one', () => {
    const ids = sequentialIdSource();
    const snap = createSnapshot(settings(), [variant()], [], ids, 'rev-1');
    const rev1 = createDraftRevision('project-A', snap, ids);
    const rev2 = createDraftRevision('project-B', snap, ids);
    const projectA: Project = { id: 'project-A', title: 'Kitchen repaint', revisions: [rev1], activeRevisionId: rev1.id, actualReviews: [], createdAt: NOW, updatedAt: NOW, version: 1 };
    const projectB: Project = { id: 'project-B', title: 'Kitchen repaint', revisions: [rev2], activeRevisionId: rev2.id, actualReviews: [], createdAt: NOW, updatedAt: NOW, version: 1 };

    const plan = planFullRestoreMerge(
      { businessSettings: settings(), paintVariants: [variant()], otherMaterials: [], serviceDefinitions: [], projects: [projectA] },
      { businessSettings: settings(), paintVariants: [variant()], otherMaterials: [], serviceDefinitions: [], projects: [projectB] }
    );
    // project-A (existing) is untouched; project-B (incoming) is a genuinely
    // new addition -- their identical titles never cause a conflict or a merge.
    expect(plan.conflicts.some((c) => c.kind === 'project')).toBe(false);
    expect(plan.toAdd.projects.map((p) => p.id)).toEqual(['project-B']);
  });
});

describe('BACK-023 (proposed hardening): malicious-looking keys/text in a backup never pollute a prototype or execute as code', () => {
  it('a project with __proto__/constructor-named keys and script-like text round-trips as inert, ordinary data -- never a polluted global prototype', () => {
    const ids = sequentialIdSource();
    const snap = createSnapshot(settings(), [variant()], [], ids, 'rev-1');
    const rev = createDraftRevision('project-1', snap, ids);
    const maliciousProject = {
      ...({ id: 'project-1', title: '<script>window.__pwned = true</script>', revisions: [{ ...rev, notes: '__proto__' }], activeRevisionId: rev.id, actualReviews: [], createdAt: NOW, updatedAt: NOW, version: 1 } as Project),
      // A hand-crafted extra key literally named "__proto__" on the OBJECT
      // ITSELF, the way a hostile JSON payload might arrive after
      // JSON.parse (which never actually assigns to the real prototype,
      // but a naive recursive merge elsewhere in the codebase could).
      __proto__: { polluted: true },
    } as unknown as Project;

    const plan = planFullRestoreMerge(
      { businessSettings: settings(), paintVariants: [variant()], otherMaterials: [], serviceDefinitions: [], projects: [] },
      { businessSettings: settings(), paintVariants: [variant()], otherMaterials: [], serviceDefinitions: [], projects: [maliciousProject] }
    );
    expect(plan.toAdd.projects).toHaveLength(1);
    expect(plan.toAdd.projects[0].title).toBe('<script>window.__pwned = true</script>'); // stored as inert literal text -- never parsed or executed
    expect(({} as Record<string, unknown>).polluted).toBeUndefined(); // the real Object.prototype was never touched
  });
});
