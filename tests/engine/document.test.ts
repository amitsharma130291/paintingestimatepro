// DOC/NUM: free-document ledger rounding and the internal cost-breakdown
// rounding-adjustment row.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { computeDocumentTotals, reconcileDisplayedComponents } from '../../src/engine/document';

const d = (n: string) => new PEP(n);

describe('DOC: free-document ledger and cost-breakdown reconciliation', () => {
  it('DOC-01: an untouched blank line contributes nothing (caller filters it before this call)', () => {
    const totals = computeDocumentTotals([], false, d('0'));
    expect(totals.subtotal.toNumber()).toBe(0);
    expect(totals.total.toNumber()).toBe(0);
  });

  it('DOC-02: tax computes on the ROUNDED subtotal, not on raw unrounded line sums', () => {
    // Two lines of 12.005 round to 12.01 each -> subtotal 24.02, not 24.01.
    const totals = computeDocumentTotals(
      [
        { quantity: d('1'), unitSellingPrice: d('12.005') },
        { quantity: d('1'), unitSellingPrice: d('12.005') },
      ],
      true,
      d('0.10')
    );
    expect(totals.lineTotals.map((t) => t.toFixed(2))).toEqual(['12.01', '12.01']);
    expect(totals.subtotal.toFixed(2)).toBe('24.02');
    expect(totals.tax.toFixed(2)).toBe('2.40');
    expect(totals.total.toFixed(2)).toBe('26.42');
  });

  it('DOC-03 (mutation guard): rounding each line first differs from summing raw then rounding once', () => {
    const summedRawThenRounded = d('12.005').plus(d('12.005')); // 24.010 -> would round to 24.01
    const totals = computeDocumentTotals(
      [
        { quantity: d('1'), unitSellingPrice: d('12.005') },
        { quantity: d('1'), unitSellingPrice: d('12.005') },
      ],
      false,
      d('0')
    );
    expect(totals.subtotal.toFixed(2)).toBe('24.02');
    expect(totals.subtotal.toFixed(2)).not.toBe(summedRawThenRounded.toFixed(2));
  });

  it('COST-reconcile-01: mismatched rounded components surface an explicit adjustment row', () => {
    const { displayed, displayedTotal, adjustment } = reconcileDisplayedComponents([d('0.005'), d('0.005')], d('0.01'));
    expect(displayed.map((x) => x.toFixed(2))).toEqual(['0.01', '0.01']); // each rounds up independently
    expect(displayedTotal.toFixed(2)).toBe('0.01'); // raw total (0.01) rounds to 0.01
    expect(adjustment.toFixed(2)).toBe('-0.01'); // 0.01 - (0.01+0.01) = -0.01, shown, not hidden
  });

  it('TPL-005: one simple line, quantity 2 at $12.50, computes a line/subtotal of exactly $25.00', () => {
    const totals = computeDocumentTotals([{ quantity: d('2'), unitSellingPrice: d('12.50') }], false, d('0'));
    expect(totals.lineTotals[0].toFixed(2)).toBe('25.00');
    expect(totals.subtotal.toFixed(2)).toBe('25.00');
  });

  it('TPL-007: one line, quantity 3 at $0.3333, extends to raw $0.9999 -> rounds to $1.00, matching the subtotal', () => {
    // lineTotal() itself rounds HALF_UP to cents (CALCULATION_SPEC §7) --
    // the raw extension (0.9999) never reaches the caller unrounded.
    const rawExtension = d('3').times(d('0.3333'));
    expect(rawExtension.toString()).toBe('0.9999');
    const totals = computeDocumentTotals([{ quantity: d('3'), unitSellingPrice: d('0.3333') }], false, d('0'));
    expect(totals.lineTotals[0].toFixed(2)).toBe('1.00'); // HALF_UP rounds 0.9999 up to 1.00
    expect(totals.subtotal.toFixed(2)).toBe('1.00');
  });

  it('TPL-008: disabling tax ignores a retained nonzero taxRatio entirely -- tax=$0, total=subtotal', () => {
    const totals = computeDocumentTotals([{ quantity: d('1'), unitSellingPrice: d('100') }], false, d('0.10'));
    expect(totals.tax.toFixed(2)).toBe('0.00'); // the 0.10 ratio is passed but taxApplies=false means it's never used
    expect(totals.total.toFixed(2)).toBe('100.00');
  });

  it('TPL-009: tax explicitly enabled at ratio 0 computes a valid $0 tax -- no forced nonzero assumption', () => {
    const totals = computeDocumentTotals([{ quantity: d('1'), unitSellingPrice: d('100') }], true, d('0'));
    expect(totals.tax.toFixed(2)).toBe('0.00');
    expect(totals.total.toFixed(2)).toBe('100.00');
  });
});
