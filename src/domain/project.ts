import type { EstimateRevision, Project, RateSnapshot, Room, Surface, CustomerDocumentSnapshot, ActualReview } from './entities';
import { ENGINE_VERSION } from './entities';
import type { IdSource } from './ids';
import { parseDecimalField } from '../engine/parse';

/**
 * DATA_CONTRACT.md "Drafts, issue, and revisions". Every mutation here
 * returns a NEW object graph (no in-place mutation of the input) — that is
 * itself part of what keeps an issued revision immutable: nothing in this
 * module ever assigns into an existing EstimateRevision's fields.
 */

export function createDraftRevision(
  projectId: string,
  snapshot: RateSnapshot,
  ids: IdSource,
  revisionNumber = 1
): EstimateRevision {
  const now = ids.now();
  // V5-05/CAT-010: this used to hardcode {mode:'none'} regardless of the
  // configured business default, silently omitting the assumption from
  // every new draft's material cost. tool-specs/04: "Travel default
  // becomes exactly one new-draft expense line" plus "Supplies allowance
  // is one mutually exclusive mode" — both defaults live on the snapshot's
  // OWN captured businessSettings, so a new draft applies exactly the
  // configuration in effect at creation time, and an already-created
  // draft's own snapshot is never retroactively changed by a later
  // settings edit (this function is never called again for an existing
  // draft — only for a brand-new one).
  const settings = snapshot.businessSettings;
  const suppliesAllowance = { ...settings.defaultSuppliesAllowance };
  const travelField = parseDecimalField(settings.defaultTravelAmount);
  const otherExpenses =
    travelField.kind === 'valid' && travelField.value.greaterThan(0)
      ? [{ id: ids.nextId(), description: 'Travel', amount: settings.defaultTravelAmount }]
      : [];
  return {
    id: ids.nextId(),
    projectId,
    revisionNumber,
    state: 'draft',
    title: '',
    businessInfo: { name: '', contact: '', address: '' },
    customerInfo: { name: '', address: '', contact: '' },
    rooms: [],
    surfaces: [],
    activeRateSnapshot: snapshot,
    additionalLabor: [],
    otherMaterialLines: [],
    suppliesAllowance,
    otherExpenses,
    priceMode: 'suggested',
    proposedPrice: null,
    notes: '',
    terms: '',
    calculationState: 'incomplete',
    engineVersion: ENGINE_VERSION,
    rawCalculatedOutputs: null,
    customerDocumentSnapshot: null,
    issuedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export interface IssueGateResult {
  canIssue: boolean;
  reasons: string[];
}

/** DATA_CONTRACT: "Priced issue needs a project title and at least one
 * enabled valid surface, and confirmed assumptions." Zero price is allowed
 * ONLY with explicit confirmation. */
export function checkIssueGate(revision: EstimateRevision, opts: { sampleAssumptionsConfirmed: boolean; zeroPriceConfirmed: boolean }): IssueGateResult {
  const reasons: string[] = [];
  if (revision.calculationState !== 'complete') reasons.push('Estimate is not complete — check for missing or invalid inputs.');
  if (!revision.title.trim()) reasons.push('Project title is required to issue.');
  if (!revision.surfaces.some((s) => s.enabled)) reasons.push('At least one enabled surface is required to issue.');
  if (!opts.sampleAssumptionsConfirmed) reasons.push('Sample business assumptions must be confirmed before the first priced issue.');
  if (revision.proposedPrice === null) reasons.push('A proposed price is required to issue (or explicitly confirm a $0 no-charge estimate).');
  // independent-review R07: compared the raw string to the literal '0',
  // so '0.00'/'0.0' silently bypassed the no-charge confirmation gate.
  // Parse to the actual numeric value and compare that to zero instead.
  const parsedPrice = revision.proposedPrice === null ? null : parseDecimalField(revision.proposedPrice);
  if (parsedPrice?.kind === 'valid' && parsedPrice.value.isZero() && !opts.zeroPriceConfirmed) {
    reasons.push('A $0 price requires explicit no-charge confirmation.');
  }
  return { canIssue: reasons.length === 0, reasons };
}

export function issueRevision(
  revision: EstimateRevision,
  buildCustomerDocument: (r: EstimateRevision) => CustomerDocumentSnapshot,
  ids: IdSource
): EstimateRevision {
  const now = ids.now();
  // BUG_FIX_LOG #4: build the document from the ALREADY-issued revision, not
  // the pre-issue draft — otherwise the callback sees state:'draft' and every
  // issued customer document is permanently stamped "draft".
  const issued: EstimateRevision = { ...structuredClone(revision), state: 'issued', issuedAt: now, updatedAt: now };
  return { ...issued, customerDocumentSnapshot: buildCustomerDocument(issued) };
}

/** DATA_CONTRACT #5: editing an issued revision NEVER mutates it — it
 * creates a new draft revision. The original issued revision object is
 * returned untouched (caller keeps both in the project's revisions[]). */
export function createDraftFromIssued(issued: EstimateRevision, ids: IdSource): EstimateRevision {
  const now = ids.now();
  return {
    ...structuredClone(issued),
    id: ids.nextId(),
    revisionNumber: issued.revisionNumber + 1,
    state: 'draft',
    issuedAt: null,
    customerDocumentSnapshot: null,
    createdAt: now,
    updatedAt: now,
    // v7.2: `issued` may itself carry a preRefreshCheckpoint from before
    // IT was issued (a self-clone sharing `issued`'s own id). Carrying
    // that over unchanged would leave this brand-new draft's checkpoint
    // pointing at a DIFFERENT revision's id (the one just superseded),
    // which validateBackupEnvelope correctly rejects as inconsistent. A
    // fresh draft has no undo-refresh history of its own yet -- "Undo
    // refresh" only becomes available once THIS draft performs its own
    // refresh (see rateRefresh.ts's applyRateRefresh, which always sets
    // its own self-consistent checkpoint).
    preRefreshCheckpoint: null,
  };
}

/** Only an explicit issue of a NEW revision supersedes the previous issued
 * one — creating a draft from it does not. */
export function supersede(previouslyIssued: EstimateRevision, ids: IdSource): EstimateRevision {
  return { ...structuredClone(previouslyIssued), state: 'superseded', updatedAt: ids.now() };
}

export function updateRoom(revision: EstimateRevision, roomId: string, patch: Partial<Room>, ids: IdSource): EstimateRevision {
  return {
    ...structuredClone(revision),
    rooms: revision.rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)),
    updatedAt: ids.now(),
  };
}

export function removeRoom(revision: EstimateRevision, roomId: string, ids: IdSource): EstimateRevision {
  const room = revision.rooms.find((r) => r.id === roomId);
  const orphanedSurfaceIds = new Set(room?.surfaceIds ?? []);
  return {
    ...structuredClone(revision),
    rooms: revision.rooms.filter((r) => r.id !== roomId),
    surfaces: revision.surfaces.filter((s) => !orphanedSurfaceIds.has(s.id)),
    updatedAt: ids.now(),
  };
}

export function setProposedPrice(revision: EstimateRevision, price: string | null, mode: 'suggested' | 'custom', ids: IdSource): EstimateRevision {
  return { ...structuredClone(revision), proposedPrice: price, priceMode: mode, updatedAt: ids.now() };
}

/**
 * PRO-014: reorders `revision.rooms` by swapping a room with its adjacent
 * sibling — display order only. IDs are never touched (never index-based
 * identity — a room's `id` is unrelated to its array position before or
 * after the move), so every reference to it (surfaceIds pointing INTO
 * it, actualReviews, etc.) stays valid, and buildCustomerDocument's own
 * room-order-follows-array-order behavior means the customer document
 * reorders along with it for free. A no-op at the first/last boundary
 * (no wraparound) rather than throwing.
 */
export function moveRoom(revision: EstimateRevision, roomId: string, direction: 'up' | 'down', ids: IdSource): EstimateRevision {
  const index = revision.rooms.findIndex((r) => r.id === roomId);
  if (index === -1) return revision;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= revision.rooms.length) return revision;
  const rooms = [...revision.rooms];
  [rooms[index], rooms[targetIndex]] = [rooms[targetIndex], rooms[index]];
  return { ...structuredClone(revision), rooms, updatedAt: ids.now() };
}

/**
 * PRO-014: reorders `revision.surfaces` by swapping a surface with its
 * nearest sibling that shares the SAME group (same `roomId`, including
 * the standalone group where `roomId === null`) — never a globally
 * adjacent surface belonging to a different room, which would silently
 * fail to change anything the user can actually see in that room's own
 * list (RoomEditor renders `surfaces.filter(s => room.surfaceIds.includes(s.id))`,
 * preserving `revision.surfaces`' own order). A no-op at the first/last
 * boundary within the group.
 */
export function moveSurfaceWithinGroup(revision: EstimateRevision, surfaceId: string, direction: 'up' | 'down', ids: IdSource): EstimateRevision {
  const fullIndex = revision.surfaces.findIndex((s) => s.id === surfaceId);
  if (fullIndex === -1) return revision;
  const groupRoomId = revision.surfaces[fullIndex].roomId;
  const groupIndices: number[] = [];
  revision.surfaces.forEach((s, i) => {
    if (s.roomId === groupRoomId) groupIndices.push(i);
  });
  const posInGroup = groupIndices.indexOf(fullIndex);
  const targetPosInGroup = direction === 'up' ? posInGroup - 1 : posInGroup + 1;
  if (targetPosInGroup < 0 || targetPosInGroup >= groupIndices.length) return revision;
  const targetFullIndex = groupIndices[targetPosInGroup];
  const surfaces = [...revision.surfaces];
  [surfaces[fullIndex], surfaces[targetFullIndex]] = [surfaces[targetFullIndex], surfaces[fullIndex]];
  return { ...structuredClone(revision), surfaces, updatedAt: ids.now() };
}

/**
 * BUG_FIX_LOG #7: saving a revision whose id is not already in
 * `project.revisions` (e.g. a brand-new draft from `createDraftFromIssued`)
 * must APPEND it. A naive `revisions.map((r) => r.id === x.id ? x : r)`
 * silently does nothing when no existing revision matches — the new
 * revision is dropped even though the caller believes it saved
 * successfully. Use this everywhere a revision is written back into its
 * project, whether it is a first save or a later edit.
 */
export function upsertRevision(project: Project, revision: EstimateRevision): Project {
  const exists = project.revisions.some((r) => r.id === revision.id);
  const revisions = exists ? project.revisions.map((r) => (r.id === revision.id ? revision : r)) : [...project.revisions, revision];
  return { ...project, revisions };
}

/**
 * ACT-013/014 fix: the actual-cost review UI previously kept its state in
 * plain React state that was never written to `project.actualReviews` or
 * IndexedDB at all — reloading the page silently lost every recorded
 * actual. Same append-or-replace shape as `upsertRevision`, keyed by the
 * review's own id (one review per issued baseline in the current UI, but
 * the id is what's authoritative, not the baseline, so re-recording never
 * accidentally creates two competing reviews for the same id).
 */
export function upsertActualReview(project: Project, review: ActualReview): Project {
  const exists = project.actualReviews.some((r) => r.id === review.id);
  const actualReviews = exists ? project.actualReviews.map((r) => (r.id === review.id ? review : r)) : [...project.actualReviews, review];
  return { ...project, actualReviews };
}

/**
 * DATA_CONTRACT #6: fresh IDs throughout, remapped references, drops
 * issued state/documents/actuals, clears estimate number. "Copies rates by
 * default" is resolved here (IMPLEMENTATION_DECISIONS.md) as: copy the
 * VALUES of the source's active snapshot into a brand-new RateSnapshot
 * (new id/capturedAt), not a live re-pull — duplicating a job should start
 * from the assumptions you actually used, not today's possibly-different
 * catalog. It never shares mutable arrays/objects with the source.
 */
export function duplicateProject(source: Project, ids: IdSource): Project {
  const now = ids.now();
  const sourceRevision = source.revisions.find((r) => r.id === source.activeRevisionId) ?? source.revisions[source.revisions.length - 1];

  const newSnapshot: RateSnapshot = {
    ...structuredClone(sourceRevision.activeRateSnapshot),
    id: ids.nextId(),
    capturedAt: now,
  };

  const roomIdMap = new Map(sourceRevision.rooms.map((r) => [r.id, ids.nextId()]));
  const surfaceIdMap = new Map(sourceRevision.surfaces.map((s) => [s.id, ids.nextId()]));

  const newRooms: Room[] = sourceRevision.rooms.map((r) => ({
    ...structuredClone(r),
    id: roomIdMap.get(r.id)!,
    surfaceIds: r.surfaceIds.map((sid) => surfaceIdMap.get(sid)!),
    openings: r.openings.map((o) => ({ ...o, id: ids.nextId() })),
  }));

  const newSurfaces: Surface[] = sourceRevision.surfaces.map((s) => ({
    ...structuredClone(s),
    id: surfaceIdMap.get(s.id)!,
    roomId: s.roomId ? roomIdMap.get(s.roomId)! : null,
  }));

  const newRevisionId = ids.nextId();
  const newProjectId = ids.nextId();

  const newRevision: EstimateRevision = {
    ...structuredClone(sourceRevision),
    id: newRevisionId,
    projectId: newProjectId,
    revisionNumber: 1,
    state: 'draft',
    rooms: newRooms,
    surfaces: newSurfaces,
    activeRateSnapshot: newSnapshot,
    additionalLabor: sourceRevision.additionalLabor.map((l) => ({ ...l, id: ids.nextId() })),
    otherMaterialLines: sourceRevision.otherMaterialLines.map((l) => ({ ...l, id: ids.nextId() })),
    otherExpenses: sourceRevision.otherExpenses.map((l) => ({ ...l, id: ids.nextId() })),
    issuedAt: null,
    customerDocumentSnapshot: null,
    createdAt: now,
    updatedAt: now,
  };
  // Estimate number is document metadata (not modeled as its own field on
  // EstimateRevision here) — cleared via businessInfo/customerInfo carry-over
  // policy: header info is retained, identifiers are not.

  return {
    id: newProjectId,
    title: `${source.title} (copy)`,
    revisions: [newRevision],
    activeRevisionId: newRevisionId,
    actualReviews: [], // duplication drops actuals
    createdAt: now,
    updatedAt: now,
    version: 1, // a brand-new project record, independent of the source's own version history
  };
}
