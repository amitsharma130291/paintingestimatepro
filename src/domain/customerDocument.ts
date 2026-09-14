import type { EstimateRevision, CustomerDocumentSnapshot } from './entities';

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
  const scopeLines = revision.rooms.map((room) => {
    const surfaces = revision.surfaces.filter((s) => room.surfaceIds.includes(s.id) && s.enabled);
    const kinds = surfaces.map((s) => s.kind);
    return `${room.name || 'Room'}: ${kinds.join(', ') || 'no surfaces enabled'}`;
  });

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
