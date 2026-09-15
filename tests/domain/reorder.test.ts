// PRO-014: room/surface display-order changes must never touch an
// entity's own id or any reference into it (surfaceIds, actualReviews'
// baselineIssuedRevisionId, etc.), never change a calculated value, and
// must behave correctly at the first/last boundary (no-op, not a crash
// or wraparound).
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision, moveRoom, moveSurfaceWithinGroup } from '../../src/domain/project';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { buildCustomerDocument } from '../../src/domain/customerDocument';
import { exportBackup, validateBackupEnvelope, planImportAsCopies } from '../../src/domain/backup';
import type { BusinessSettings, PaintVariant, Room, Surface, EstimateRevision, Project } from '../../src/domain/entities';

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
function baseRevision(): EstimateRevision {
  const ids = sequentialIdSource();
  const snap = createSnapshot(settings(), [variant()], [], ids, 'rev-1');
  return createDraftRevision('project-1', snap, ids);
}
function room(id: string, name: string, surfaceIds: string[]): Room {
  return { id, name, lengthFt: '10', widthFt: '10', heightFt: '8', deductionEnabled: false, openingMode: 'quick', quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' }, openings: [], surfaceIds };
}
function wall(id: string, roomId: string | null): Surface {
  return { id, roomId, kind: 'wall', enabled: true, measurementMode: roomId ? 'roomDerived' : 'manual', areaFt2: roomId ? null : '100', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null };
}
function door(id: string): Surface {
  return { id, roomId: null, kind: 'door', enabled: true, measurementMode: 'manual', areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: 1, widthFt: '3', heightFt: '7', paintedSides: 2, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null };
}

describe('PRO-014: moveRoom reorders display order only', () => {
  function threeRooms(): EstimateRevision {
    const w1 = wall('wall-1', 'room-1');
    const w2 = wall('wall-2', 'room-2');
    const w3 = wall('wall-3', 'room-3');
    return { ...baseRevision(), rooms: [room('room-1', 'A', ['wall-1']), room('room-2', 'B', ['wall-2']), room('room-3', 'C', ['wall-3'])], surfaces: [w1, w2, w3] };
  }
  const ids = sequentialIdSource();

  it('moving the middle room up swaps it with the first', () => {
    const revision = moveRoom(threeRooms(), 'room-2', 'up', ids);
    expect(revision.rooms.map((r) => r.id)).toEqual(['room-2', 'room-1', 'room-3']);
  });

  it('moving the middle room down swaps it with the last', () => {
    const revision = moveRoom(threeRooms(), 'room-2', 'down', ids);
    expect(revision.rooms.map((r) => r.id)).toEqual(['room-1', 'room-3', 'room-2']);
  });

  it('moving the first room up is a no-op (boundary)', () => {
    const before = threeRooms();
    const after = moveRoom(before, 'room-1', 'up', ids);
    expect(after.rooms.map((r) => r.id)).toEqual(before.rooms.map((r) => r.id));
  });

  it('moving the last room down is a no-op (boundary)', () => {
    const before = threeRooms();
    const after = moveRoom(before, 'room-3', 'down', ids);
    expect(after.rooms.map((r) => r.id)).toEqual(before.rooms.map((r) => r.id));
  });

  it('room ids and their surfaceIds cross-references are completely unchanged by reordering', () => {
    const before = threeRooms();
    const after = moveRoom(before, 'room-2', 'up', ids);
    for (const r of after.rooms) {
      const original = before.rooms.find((x) => x.id === r.id)!;
      expect(r.surfaceIds).toEqual(original.surfaceIds);
    }
  });

  it('a nonexistent room id is a no-op, not a crash', () => {
    const before = threeRooms();
    const after = moveRoom(before, 'does-not-exist', 'up', ids);
    expect(after.rooms.map((r) => r.id)).toEqual(before.rooms.map((r) => r.id));
  });

  it('reordering rooms does not change the calculated estimate at all', () => {
    const before = threeRooms();
    const after = moveRoom(before, 'room-2', 'up', ids);
    const beforeOut = assembleProjectEstimate(before, { priceMode: 'suggested', customPriceRaw: '' });
    const afterOut = assembleProjectEstimate(after, { priceMode: 'suggested', customPriceRaw: '' });
    expect(beforeOut.calculationState).toBe('complete');
    expect(afterOut.materials!.toString()).toBe(beforeOut.materials!.toString());
    expect(afterOut.laborCost!.toString()).toBe(beforeOut.laborCost!.toString());
    expect(afterOut.jobCost!.toString()).toBe(beforeOut.jobCost!.toString());
  });

  it('the customer document\'s scope-line order follows the new room order', () => {
    const before = threeRooms();
    const after = moveRoom(before, 'room-2', 'up', ids);
    const doc = buildCustomerDocument(after, { estimateNumber: 'E-1', estimateDate: '2026-01-01', projectAddress: '', revisionLabel: 'Rev 1' });
    expect(doc.scopeLines[0]).toMatch(/^B:/);
    expect(doc.scopeLines[1]).toMatch(/^A:/);
    expect(doc.scopeLines[2]).toMatch(/^C:/);
  });

  it('a reordered room order survives a full export/validate/import round trip, and import-as-copy preserves it too', () => {
    const ids = sequentialIdSource();
    const reordered = moveRoom(threeRooms(), 'room-2', 'up', ids); // B, A, C
    const project: Project = { id: reordered.projectId, title: 'Job', revisions: [reordered], activeRevisionId: reordered.id, actualReviews: [], createdAt: ids.now(), updatedAt: ids.now(), version: 1 };

    const envelope = exportBackup('install-1', settings(), [variant()], [], [], [project], ids);
    const validated = validateBackupEnvelope(envelope, JSON.stringify(envelope).length);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.envelope.projects[0].revisions[0].rooms.map((r) => r.name)).toEqual(['B', 'A', 'C']);

    const copy = planImportAsCopies([project], 'export-1', new Set(), ids).projects[0];
    expect(copy.revisions[0].rooms.map((r) => r.name)).toEqual(['B', 'A', 'C']);
  });
});

describe('PRO-014: moveSurfaceWithinGroup reorders siblings sharing the same room (or standalone group) only', () => {
  function standaloneDoors(): EstimateRevision {
    return { ...baseRevision(), rooms: [], surfaces: [door('door-1'), door('door-2'), door('door-3')] };
  }
  const ids = sequentialIdSource();

  it('moving the middle standalone surface up swaps it with the first', () => {
    const revision = moveSurfaceWithinGroup(standaloneDoors(), 'door-2', 'up', ids);
    expect(revision.surfaces.map((s) => s.id)).toEqual(['door-2', 'door-1', 'door-3']);
  });

  it('moving the first standalone surface up is a no-op (boundary)', () => {
    const before = standaloneDoors();
    const after = moveSurfaceWithinGroup(before, 'door-1', 'up', ids);
    expect(after.surfaces.map((s) => s.id)).toEqual(before.surfaces.map((s) => s.id));
  });

  it('moving the last standalone surface down is a no-op (boundary)', () => {
    const before = standaloneDoors();
    const after = moveSurfaceWithinGroup(before, 'door-3', 'down', ids);
    expect(after.surfaces.map((s) => s.id)).toEqual(before.surfaces.map((s) => s.id));
  });

  it('a surface belonging to a DIFFERENT room is never swapped with -- only same-group siblings move', () => {
    // door-2 (standalone) is sandwiched, in the full array, between two
    // ROOM surfaces it must never trade places with.
    const revision: EstimateRevision = { ...baseRevision(), rooms: [room('room-1', 'A', ['wall-1'])], surfaces: [wall('wall-1', 'room-1'), door('door-1'), door('door-2')] };
    const after = moveSurfaceWithinGroup(revision, 'door-1', 'up', ids);
    // door-1 has no standalone sibling above it (wall-1 belongs to a
    // different group) -- this must be a no-op, never swapping with wall-1.
    expect(after.surfaces.map((s) => s.id)).toEqual(['wall-1', 'door-1', 'door-2']);
  });

  it('does not change calculated totals', () => {
    const before = standaloneDoors();
    const after = moveSurfaceWithinGroup(before, 'door-2', 'up', ids);
    const beforeOut = assembleProjectEstimate(before, { priceMode: 'suggested', customPriceRaw: '' });
    const afterOut = assembleProjectEstimate(after, { priceMode: 'suggested', customPriceRaw: '' });
    expect(afterOut.materials!.toString()).toBe(beforeOut.materials!.toString());
    expect(afterOut.laborCost!.toString()).toBe(beforeOut.laborCost!.toString());
  });

  it('a nonexistent surface id is a no-op, not a crash', () => {
    const before = standaloneDoors();
    const after = moveSurfaceWithinGroup(before, 'does-not-exist', 'up', ids);
    expect(after.surfaces.map((s) => s.id)).toEqual(before.surfaces.map((s) => s.id));
  });
});
