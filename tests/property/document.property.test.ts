// PROPERTY_TESTS.md items 15,16: ledger reconciliation and cost-display
// reconciliation always hold exactly, by construction.
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { PEP } from '../../src/engine/decimal';
import { computeDocumentTotals, reconcileDisplayedComponents } from '../../src/engine/document';

const SEED = 20260914;
const NUM_RUNS = 200;

describe('PROPERTY 15: free-document ledger reconciliation', () => {
  it('sum of rounded line cents + rounded tax === document total, exactly, for any line set', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ qty: fc.integer({ min: 0, max: 1000 }), price: fc.integer({ min: 0, max: 100000 }) }), { maxLength: 20 }),
        fc.integer({ min: 0, max: 100 }),
        (rows, taxBp) => {
          const lines = rows.map((r) => ({ quantity: new PEP(r.qty), unitSellingPrice: new PEP(r.price).dividedBy(1000) }));
          const totals = computeDocumentTotals(lines, true, new PEP(taxBp).dividedBy(1000));
          const sumOfLines = totals.lineTotals.reduce((s, t) => s.plus(t), new PEP(0));
          return sumOfLines.equals(totals.subtotal) && totals.subtotal.plus(totals.tax).equals(totals.total);
        }
      ),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});

describe('PROPERTY 16: cost-display reconciliation never touches the raw model', () => {
  it('displayed components + adjustment always equals the displayed total, and adjustment is derived, not model-mutating', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 100000 }), { minLength: 1, maxLength: 10 }), (centsList) => {
        const components = centsList.map((c) => new PEP(c).dividedBy(1000));
        const rawTotal = components.reduce((s, c) => s.plus(c), new PEP(0));
        const { displayed, displayedTotal, adjustment } = reconcileDisplayedComponents(components, rawTotal);
        const sumDisplayed = displayed.reduce((s, c) => s.plus(c), new PEP(0));
        return sumDisplayed.plus(adjustment).equals(displayedTotal);
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});
