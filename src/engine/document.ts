import { PEP, halfUp, type Dec } from './decimal';

/**
 * CALCULATION_SPEC.md §7 — the FREE manual document is a deliberately
 * separate monetary-ledger boundary from internal cost estimation: round
 * EACH line to cents HALF_UP first, sum the rounded cents, then round tax
 * on that rounded subtotal. This is NOT the same as summing raw and
 * rounding once — two $12.005 lines round to $12.01 each ($24.02 total),
 * not $24.01 (which summing-then-rounding would give).
 */

export interface DocumentLineInput {
  quantity: Dec;
  unitSellingPrice: Dec;
}

export function lineTotal(line: DocumentLineInput): Dec {
  return halfUp(line.quantity.times(line.unitSellingPrice), 2);
}

export interface DocumentTotals {
  lineTotals: Dec[];
  subtotal: Dec;
  tax: Dec;
  total: Dec;
}

export function computeDocumentTotals(lines: DocumentLineInput[], taxEnabled: boolean, taxRatio: Dec): DocumentTotals {
  const lineTotals = lines.map(lineTotal);
  const subtotal = lineTotals.reduce((sum, t) => sum.plus(t), new PEP(0));
  const tax = taxEnabled ? halfUp(subtotal.times(taxRatio), 2) : new PEP(0);
  return { lineTotals, subtotal, tax, total: subtotal.plus(tax) };
}

/**
 * CALCULATION_SPEC.md §7 — internal cost-breakdown reconciliation: sum RAW
 * components, round the grand total once, and if the sum of the
 * individually-displayed (rounded) components doesn't match the displayed
 * total, surface the difference as an explicit rounding-adjustment row
 * rather than silently disagreeing with itself on screen.
 */
export function reconcileDisplayedComponents(rawComponents: Dec[], rawTotal: Dec): { displayed: Dec[]; displayedTotal: Dec; adjustment: Dec } {
  const displayed = rawComponents.map((c) => halfUp(c, 2));
  const displayedTotal = halfUp(rawTotal, 2);
  const sumOfDisplayed = displayed.reduce((sum, c) => sum.plus(c), new PEP(0));
  const adjustment = displayedTotal.minus(sumOfDisplayed);
  return { displayed, displayedTotal, adjustment };
}
