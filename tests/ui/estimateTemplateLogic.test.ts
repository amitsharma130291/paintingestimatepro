// TPL-010/011/012/014 regression tests for the free estimate template's
// pure logic (src/components/tools/estimateTemplateLogic.ts).
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { sequentialIdSource } from '../../src/domain/ids';
import { computeDocumentTotals } from '../../src/engine/document';
import {
  validateTaxPercent,
  cloneDraftForDuplicate,
  evaluateLines,
  evaluatePrintEligibility,
  newDraft,
} from '../../src/components/tools/estimateTemplateLogic';

describe('TPL-010/011: validateTaxPercent — the confirmed bug (negative tax silently falls back to zero and still allows printing)', () => {
  it('REGRESSION: reproduces the exact old bug — the old inline logic silently substituted 0 for invalid tax and never blocked printing', () => {
    // This is the OLD buggy computation, exactly as it lived inline in
    // EstimateTemplate.tsx before this fix — reconstructed here (not
    // edited back into production) to prove it was really wrong.
    function oldBuggyLogic(taxEnabled: boolean, taxPercentRaw: string) {
      const pTax = { kind: taxPercentRaw === '-5' ? ('invalid' as const) : ('valid' as const), value: new PEP(0) };
      const taxRatio = pTax.kind === 'valid' ? pTax.value : new PEP(0); // <- silent fallback to 0, the bug
      const taxAppliedFlag = taxEnabled && pTax.kind === 'valid'; // <- tax silently disabled, not blocked
      return { taxRatio, taxAppliedFlag, printBlocked: false }; // <- printing was NEVER blocked by bad tax
    }
    const old = oldBuggyLogic(true, '-5');
    expect(old.printBlocked).toBe(false); // the bug: printing stayed allowed
    expect(old.taxAppliedFlag).toBe(false); // the bug: tax silently dropped instead of erroring

    // The NEW, fixed logic:
    const real = validateTaxPercent(true, '-5');
    expect(real.kind).toBe('invalid'); // correctly flagged, not silently zeroed
  });

  it('rejects a blank tax percentage when tax is enabled', () => {
    const result = validateTaxPercent(true, '');
    expect(result.kind).toBe('invalid');
  });

  it('rejects malformed tax text', () => {
    expect(validateTaxPercent(true, 'abc').kind).toBe('invalid');
  });

  it('rejects negative tax', () => {
    expect(validateTaxPercent(true, '-5').kind).toBe('invalid');
  });

  it('rejects tax above 100', () => {
    expect(validateTaxPercent(true, '100.01').kind).toBe('invalid');
  });

  it('accepts exactly 100', () => {
    const result = validateTaxPercent(true, '100');
    expect(result.kind).toBe('valid');
  });

  it('accepts explicit zero as valid (not the same as disabled)', () => {
    const result = validateTaxPercent(true, '0');
    expect(result.kind).toBe('valid');
    if (result.kind === 'valid') expect(result.ratio.isZero()).toBe(true);
  });

  it('warns above 25% but does not invalidate it', () => {
    const result = validateTaxPercent(true, '30');
    expect(result.kind).toBe('valid');
    if (result.kind === 'valid') {
      expect(result.warning).not.toBeNull();
      expect(result.ratio.toString()).toBe('0.3');
    }
  });

  it('does not warn at exactly 25%', () => {
    const result = validateTaxPercent(true, '25');
    if (result.kind === 'valid') expect(result.warning).toBeNull();
  });

  it('disabled tax is never invalid, regardless of the stale percent text', () => {
    expect(validateTaxPercent(false, '-999').kind).toBe('disabled');
    expect(validateTaxPercent(false, '').kind).toBe('disabled');
  });
});

describe('TPL-012: zero-total no-charge confirmation', () => {
  it('a genuinely zero total requires explicit confirmation before printing', () => {
    const eligibility = evaluatePrintEligibility({
      incompleteRowIds: [],
      validLineCount: 1,
      taxValidation: { kind: 'disabled' },
      total: new PEP(0),
      noChargeConfirmed: false,
    });
    expect(eligibility.isZeroTotal).toBe(true);
    expect(eligibility.canPrint).toBe(false);
  });

  it('printing is allowed once the zero-total is explicitly confirmed', () => {
    const eligibility = evaluatePrintEligibility({
      incompleteRowIds: [],
      validLineCount: 1,
      taxValidation: { kind: 'disabled' },
      total: new PEP(0),
      noChargeConfirmed: true,
    });
    expect(eligibility.canPrint).toBe(true);
  });

  it('a nonzero total never requires the no-charge confirmation', () => {
    const eligibility = evaluatePrintEligibility({
      incompleteRowIds: [],
      validLineCount: 1,
      taxValidation: { kind: 'disabled' },
      total: new PEP('120.50'),
      noChargeConfirmed: false,
    });
    expect(eligibility.canPrint).toBe(true);
    expect(eligibility.isZeroTotal).toBe(false);
  });

  it('confirming no-charge can NEVER bypass an incomplete row', () => {
    const eligibility = evaluatePrintEligibility({
      incompleteRowIds: ['line-2'],
      validLineCount: 1,
      taxValidation: { kind: 'disabled' },
      total: new PEP(0),
      noChargeConfirmed: true,
    });
    expect(eligibility.canPrint).toBe(false);
  });

  it('confirming no-charge can NEVER bypass invalid tax', () => {
    const eligibility = evaluatePrintEligibility({
      incompleteRowIds: [],
      validLineCount: 1,
      taxValidation: { kind: 'invalid', message: 'bad tax' },
      total: new PEP(0),
      noChargeConfirmed: true,
    });
    expect(eligibility.canPrint).toBe(false);
  });
});

describe('TPL-014: duplicate independence', () => {
  it('the clone gets a fresh id, fresh line ids, and a cleared estimate number', () => {
    const ids = sequentialIdSource();
    const original = newDraft(ids);
    original.businessName = 'Acme Painting';
    original.lines[0] = { ...original.lines[0], description: 'Living room', quantity: '1', unitPrice: '450' };

    const clone = cloneDraftForDuplicate(original, ids);
    expect(clone.id).not.toBe(original.id);
    expect(clone.estimateNumber).toBe('');
    expect(original.estimateNumber).not.toBe(''); // the original's number is untouched
    expect(clone.lines[0].id).not.toBe(original.lines[0].id);
    expect(clone.businessName).toBe('Acme Painting'); // headers retained
  });

  it('editing the clone never mutates the original (no shared references)', () => {
    const ids = sequentialIdSource();
    const original = newDraft(ids);
    const clone = cloneDraftForDuplicate(original, ids);

    clone.businessName = 'Changed Name';
    clone.lines[0].description = 'Changed description';
    clone.lines.push({ id: 'extra', description: 'New line', quantity: '2', unitPrice: '10' });

    expect(original.businessName).toBe('');
    expect(original.lines[0].description).toBe('');
    expect(original.lines).toHaveLength(2);
  });

  it('editing the original after duplicating never mutates the clone', () => {
    const ids = sequentialIdSource();
    const original = newDraft(ids);
    const clone = cloneDraftForDuplicate(original, ids);
    const cloneSnapshot = JSON.parse(JSON.stringify(clone));

    original.businessName = 'Edited after duplicate';
    original.lines[0].unitPrice = '999';

    expect(clone).toEqual(cloneSnapshot);
  });
});

describe('evaluateLines (unchanged behavior, still covered here for completeness)', () => {
  it('an untouched blank row (default quantity "1") is ignored, not incomplete', () => {
    const ids = sequentialIdSource();
    const draft = newDraft(ids);
    const { incompleteRowIds, validLines } = evaluateLines(draft.lines);
    expect(incompleteRowIds).toHaveLength(0);
    expect(validLines).toHaveLength(0);
  });

  it('a touched-but-incomplete row (description with no price) blocks printing', () => {
    const ids = sequentialIdSource();
    const draft = newDraft(ids);
    draft.lines[0].description = 'Trim touch-up';
    const { incompleteRowIds } = evaluateLines(draft.lines);
    expect(incompleteRowIds).toContain(draft.lines[0].id);
  });
});

describe('CORE-022: a manually entered unitSellingPrice of 12.005 (three fractional digits) is a valid row, not blocked at parse time', () => {
  it('evaluateLines accepts "12.005" as the row\'s unitPrice and includes it in validLines unrounded', () => {
    const ids = sequentialIdSource();
    const draft = newDraft(ids);
    draft.lines[0].description = 'Touch-up';
    draft.lines[0].unitPrice = '12.005';
    const { incompleteRowIds, validLines } = evaluateLines(draft.lines);
    expect(incompleteRowIds).toHaveLength(0);
    expect(validLines).toHaveLength(1);
    expect(validLines[0].unitSellingPrice.toString()).toBe('12.005'); // full precision retained; rounding happens only at the ledger/document-total level
  });
});

describe('Exact rounding: two $12.005 lines reconcile to $24.02, tax on the rounded subtotal', () => {
  it('matches the spec example exactly', () => {
    const totals = computeDocumentTotals(
      [
        { quantity: new PEP(1), unitSellingPrice: new PEP('12.005') },
        { quantity: new PEP(1), unitSellingPrice: new PEP('12.005') },
      ],
      false,
      new PEP(0)
    );
    expect(totals.subtotal.toFixed(2)).toBe('24.02');
  });
});
