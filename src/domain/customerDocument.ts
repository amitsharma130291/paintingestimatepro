import type { EstimateRevision, Surface, CustomerDocumentSnapshot } from './entities';

/**
 * V6-01: describes ONE enabled surface's scope for the customer document --
 * kind, the coat count actually used (an explicit per-surface override, or
 * the draft's own snapshot default, matching how the calculation itself
 * resolves it), and the quantity/unit tool-specs/08 requires ("scope
 * descriptions with surfaces/coats"): door count for doors, linear feet for
 * trim. Never leaks a cost, rate, or internal quantity beyond what a
 * customer needs to recognize their own job.
 */
function describeSurfaceScope(surface: Surface, defaultCoats: number): string {
  const coats = surface.coats ?? defaultCoats;
  const coatsLabel = `${coats} coat${coats === 1 ? '' : 's'}`;
  if (surface.kind === 'door') {
    const count = surface.doorCount ?? 1;
    return `${count} door${count === 1 ? '' : 's'} (${coatsLabel})`;
  }
  if (surface.kind === 'trim') {
    return `trim${surface.trimLengthFt ? ` (${surface.trimLengthFt} ft)` : ''} (${coatsLabel})`;
  }
  return `${surface.kind} (${coatsLabel})`;
}

/**
 * tool-specs/08 + P01: an ALLOW-LIST projection, not a block-list. A new
 * private field added to EstimateRevision in the future is absent from
 * this output BY CONSTRUCTION — someone has to deliberately add it here
 * for it to ever reach a customer. This is the single function every
 * customer-facing render (screen preview, print, PDF) must go through;
 * nothing else may read `EstimateRevision` directly for customer display.
 */
export function buildCustomerDocument(
  revision: EstimateRevision,
  meta: { estimateNumber: string; estimateDate: string; projectAddress: string; revisionLabel: string }
): CustomerDocumentSnapshot {
  const defaultCoats = revision.activeRateSnapshot.businessSettings.defaultCoats;

  const roomLines = revision.rooms.map((room) => {
    const surfaces = revision.surfaces.filter((s) => room.surfaceIds.includes(s.id) && s.enabled);
    const parts = surfaces.map((s) => describeSurfaceScope(s, defaultCoats));
    return `${room.name || 'Room'}: ${parts.join(', ') || 'no surfaces enabled'}`;
  });

  // V6-01: a standalone surface (roomId === null — a door-only or trim-only
  // job, per tool-specs/05's explicit support for jobs with no room at
  // all) was never projected into the customer scope at all. The estimate
  // could be priced and issued while its customer document silently
  // described nothing.
  const standaloneLines = revision.surfaces
    .filter((s) => s.roomId === null && s.enabled)
    .map((s) => describeSurfaceScope(s, defaultCoats));

  const scopeLines = [...roomLines, ...standaloneLines];

  return {
    estimateNumber: meta.estimateNumber,
    estimateDate: meta.estimateDate,
    businessInfo: { ...revision.businessInfo },
    customerInfo: { ...revision.customerInfo },
    projectTitle: revision.title,
    projectAddress: meta.projectAddress,
    scopeLines,
    proposedPrice: revision.proposedPrice ?? '',
    notes: revision.notes,
    terms: revision.terms,
    revisionLabel: meta.revisionLabel,
    taxNotice: 'Prices exclude taxes; taxes are not calculated by this tool.',
    status: revision.state === 'issued' ? 'issued' : 'draft',
  };
}

const ALLOWED_FIELDS: readonly (keyof CustomerDocumentSnapshot)[] = [
  'estimateNumber',
  'estimateDate',
  'businessInfo',
  'customerInfo',
  'projectTitle',
  'projectAddress',
  'scopeLines',
  'proposedPrice',
  'notes',
  'terms',
  'revisionLabel',
  'taxNotice',
  'status',
];

/** A defense-in-depth check usable in tests (P01/mutation guard): given
 * whatever object is about to be rendered/exported, assert it has no keys
 * outside the allow-list — catches an accidental future leak even if
 * someone bypasses `buildCustomerDocument` and hand-assembles an object. */
export function assertOnlyAllowedFields(doc: Record<string, unknown>): void {
  const extra = Object.keys(doc).filter((k) => !ALLOWED_FIELDS.includes(k as keyof CustomerDocumentSnapshot));
  if (extra.length > 0) {
    throw new Error(`Customer document contains disallowed field(s): ${extra.join(', ')}`);
  }
}
