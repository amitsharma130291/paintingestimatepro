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
});
