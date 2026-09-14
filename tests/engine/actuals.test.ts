// ACT: partial actuals must never show a final profit/margin; explicit
// zero is a valid confirmed value, distinct from "not entered."
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { evaluateActualReview } from '../../src/engine/actuals';

const d = (n: string) => new PEP(n);
const baseline = { baselinePrice: d('3200'), baselineCost: d('2185') };

describe('ACT: actual-cost review', () => {
  it('ACT-01 (V10): confirming materials alone leaves the review in_progress with no final profit/margin', () => {
    const r = evaluateActualReview({
      materials: { confirmed: true, amount: d('700') },
      labor: { confirmed: false, amount: null },
      otherExpenses: { confirmed: false, amount: null },
      overhead: { confirmed: false, amount: null },
      ...baseline,
    });
    expect(r.state).toBe('in_progress');
    expect(r.confirmedCategories).toBe(1);
    expect(r.recordedCostSoFar.toNumber()).toBe(700);
    expect(r.actualCost).toBeNull();
    expect(r.profitAgainstOriginalQuote).toBeNull();
    expect(r.marginRatio).toBeNull();
  });

  it('ACT-02: explicit zero in every category is valid and finalizes (zero is not "missing")', () => {
    const r = evaluateActualReview({
      materials: { confirmed: true, amount: d('0') },
      labor: { confirmed: true, amount: d('0') },
      otherExpenses: { confirmed: true, amount: d('0') },
      overhead: { confirmed: true, amount: d('0') },
      baselinePrice: d('100'),
      baselineCost: d('50'),
    });
    expect(r.state).toBe('final');
    expect(r.actualCost!.toNumber()).toBe(0);
    expect(r.profitAgainstOriginalQuote!.toNumber()).toBe(100);
  });

  it('ACT-03: confirmed=true but amount=null does not count as a completed category', () => {
    const r = evaluateActualReview({
      materials: { confirmed: true, amount: null },
      labor: { confirmed: true, amount: d('1') },
      otherExpenses: { confirmed: true, amount: d('1') },
      overhead: { confirmed: true, amount: d('1') },
      ...baseline,
    });
    expect(r.state).toBe('in_progress');
    expect(r.confirmedCategories).toBe(3);
  });

  it('ACT-04 (loss, v2.1 regression): a loss retains negative profit AND a real negative margin, never suppressed', () => {
    const r = evaluateActualReview({
      materials: { confirmed: true, amount: d('1000') },
      labor: { confirmed: true, amount: d('2000') },
      otherExpenses: { confirmed: true, amount: d('200') },
      overhead: { confirmed: true, amount: d('300') },
      ...baseline,
    });
    expect(r.state).toBe('final');
    expect(r.actualCost!.toNumber()).toBe(3500);
    expect(r.profitAgainstOriginalQuote!.toNumber()).toBe(-300);
    expect(r.marginRatio!.isNegative()).toBe(true);
  });

  it('ACT-05 (zero baseline price, v2.1 regression): margin is null, but the loss amount is still retained', () => {
    const r = evaluateActualReview({
      materials: { confirmed: true, amount: d('100') },
      labor: { confirmed: true, amount: d('0') },
      otherExpenses: { confirmed: true, amount: d('0') },
      overhead: { confirmed: true, amount: d('0') },
      baselinePrice: d('0'),
      baselineCost: d('100'),
    });
    expect(r.state).toBe('final');
    expect(r.profitAgainstOriginalQuote!.toNumber()).toBe(-100);
    expect(r.marginRatio).toBeNull();
  });

  it('ACT-06 (mutation guard): margin is gated on baselinePrice > 0, NOT on profit being positive', () => {
    // A positive baseline price with a resulting loss must still produce a
    // real (negative) margin — this is exactly the fault MUTATION_CHECKS.md
    // calls out: "Gate actual margin on profit>0".
    const r = evaluateActualReview({
      materials: { confirmed: true, amount: d('5000') },
      labor: { confirmed: true, amount: d('0') },
      otherExpenses: { confirmed: true, amount: d('0') },
      overhead: { confirmed: true, amount: d('0') },
      baselinePrice: d('100'), // positive
      baselineCost: d('50'),
    });
    expect(r.profitAgainstOriginalQuote!.isNegative()).toBe(true);
    expect(r.marginRatio).not.toBeNull(); // must NOT be null just because profit is negative
    expect(r.marginRatio!.isNegative()).toBe(true);
  });
});
