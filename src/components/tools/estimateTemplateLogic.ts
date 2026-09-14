// Pure, testable logic for the free estimate template (tool-specs/01).
// Kept separate from EstimateTemplate.tsx's rendering so the
// validation/duplication rules can be tested without a DOM.
import type { Dec } from '../../engine/decimal';
import { parseDecimalField } from '../../engine/parse';
import type { IdSource } from '../../domain/ids';

export interface Line {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

export interface EstimateDraft {
  id: string;
  estimateNumber: string;
  businessName: string;
  customerName: string;
  lines: Line[];
  taxEnabled: boolean;
  taxPercent: string;
  notes: string;
  /** Explicit "I confirm this is a genuine $0 estimate" checkbox — required
   * before printing a valid document whose total is exactly 0. Resets
   * whenever the total changes so a confirmation never silently survives
   * an edit that makes the total nonzero again (or a different zero). */
  noChargeConfirmed: boolean;
}

export function newLine(idSource: IdSource): Line {
  return { id: idSource.nextId(), description: '', quantity: '1', unitPrice: '' };
}

export function newDraft(idSource: IdSource): EstimateDraft {
  return {
    id: idSource.nextId(),
    estimateNumber: `EST-${idSource.nextId().slice(0, 8).toUpperCase()}`,
    businessName: '',
    customerName: '',
    lines: [newLine(idSource), newLine(idSource)],
    taxEnabled: false,
    taxPercent: '0',
    notes: '',
    noChargeConfirmed: false,
  };
}

/**
 * TPL-010/011: tool-specs/01 requires an explicit, user-entered tax
 * percentage in [0, 100], warns above 25%, and — the actual confirmed bug —
 * must BLOCK priced printing on invalid enabled tax, never silently fall
 * back to a zero rate while still allowing output.
 */
export type TaxValidation =
  | { kind: 'disabled' }
  | { kind: 'invalid'; message: string }
  | { kind: 'valid'; ratio: Dec; warning: string | null };

export function validateTaxPercent(enabled: boolean, raw: string): TaxValidation {
  if (!enabled) return { kind: 'disabled' };
  const parsed = parseDecimalField(raw);
  if (parsed.kind === 'missing') {
    return { kind: 'invalid', message: 'Enter a tax percentage (0–100), or turn off tax.' };
  }
  if (parsed.kind === 'invalid') {
    return { kind: 'invalid', message: 'Tax percentage must be a plain number between 0 and 100.' };
  }
  if (parsed.value.greaterThan(100)) {
    return { kind: 'invalid', message: 'Tax percentage cannot exceed 100%.' };
  }
  const warning = parsed.value.greaterThan(25) ? 'Unusually high tax rate — double-check this value before sending.' : null;
  return { kind: 'valid', ratio: parsed.value.dividedBy(100), warning };
}

/**
 * TPL-014: "Duplicate deep-clones the draft with new IDs and clears
 * estimateNumber; retains headers except identifier." The source draft
 * object is never mutated — the caller keeps both the original and the
 * clone as independent entries, so editing one can never affect the other.
 */
export function cloneDraftForDuplicate(source: EstimateDraft, idSource: IdSource): EstimateDraft {
  return {
    ...structuredClone(source),
    id: idSource.nextId(),
    estimateNumber: '',
    lines: source.lines.map((l) => ({ ...l, id: idSource.nextId() })),
    noChargeConfirmed: false,
  };
}

export interface LineEvaluation {
  incompleteRowIds: string[];
  validLines: { quantity: Dec; unitSellingPrice: Dec }[];
}

/** A fresh row's quantity defaults to "1" — that default alone must NOT
 * count as "touched," or every brand-new blank row would immediately
 * register as incomplete and block printing. */
export function evaluateLines(lines: Line[]): LineEvaluation {
  const touched = lines.filter((l) => l.description.trim() !== '' || l.unitPrice.trim() !== '' || l.quantity.trim() !== '1');
  const incompleteRowIds: string[] = [];
  const validLines: { quantity: Dec; unitSellingPrice: Dec }[] = [];
  for (const l of touched) {
    const qty = parseDecimalField(l.quantity || null);
    const price = parseDecimalField(l.unitPrice || null);
    const descOk = l.description.trim() !== '';
    if (!descOk || qty.kind !== 'valid' || price.kind !== 'valid') {
      incompleteRowIds.push(l.id);
      continue;
    }
    validLines.push({ quantity: qty.value, unitSellingPrice: price.value });
  }
  return { incompleteRowIds, validLines };
}

export interface PrintEligibility {
  canPrint: boolean;
  reasons: string[];
  isZeroTotal: boolean;
}

/**
 * TPL-012: a valid $0.00 total (everything complete, tax fine, total is
 * genuinely zero) needs an explicit no-charge confirmation before it can
 * print — but that confirmation can NEVER bypass an incomplete/invalid row
 * or invalid tax; those block printing regardless of the checkbox.
 */
export function evaluatePrintEligibility(opts: {
  incompleteRowIds: string[];
  validLineCount: number;
  taxValidation: TaxValidation;
  total: Dec;
  noChargeConfirmed: boolean;
}): PrintEligibility {
  const reasons: string[] = [];
  if (opts.incompleteRowIds.length > 0) reasons.push('One or more started rows are missing a description, quantity, or price.');
  if (opts.validLineCount === 0) reasons.push('Add at least one complete line.');
  if (opts.taxValidation.kind === 'invalid') reasons.push(opts.taxValidation.message);

  const isZeroTotal = reasons.length === 0 && opts.total.isZero();
  if (isZeroTotal && !opts.noChargeConfirmed) {
    reasons.push('Confirm this is an intentional $0 no-charge estimate before printing.');
  }

  return { canPrint: reasons.length === 0, reasons, isZeroTotal };
}
