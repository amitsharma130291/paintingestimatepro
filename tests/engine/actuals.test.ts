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

  it('CORE-006: an omitted actual-cost category (unconfirmed, amount null) stays null -- never treated as an explicit zero', () => {
    // Contrast with the free job-cost calculator's NEW-estimate rule
    // (jobCostCalculatorLogic.test.ts CORE-006), where an omitted optional
    // direct-expense field defaults to an explicit 0 and never blocks. The
    // actual-cost category has the opposite default: omission means
    // "not yet confirmed," not "confirmed at zero."
    const omitted = evaluateActualReview({
      materials: { confirmed: true, amount: d('700') },
      labor: { confirmed: true, amount: d('1200') },
      otherExpenses: { confirmed: false, amount: null }, // omitted, never touched
      overhead: { confirmed: true, amount: d('150') },
      ...baseline,
    });
    expect(omitted.state).toBe('in_progress'); // NOT final -- omission is not silently zero
    expect(omitted.actualCost).toBeNull();

    const explicitZero = evaluateActualReview({
      materials: { confirmed: true, amount: d('700') },
      labor: { confirmed: true, amount: d('1200') },
      otherExpenses: { confirmed: true, amount: d('0') }, // explicitly confirmed at zero
      overhead: { confirmed: true, amount: d('150') },
      ...baseline,
    });
    expect(explicitZero.state).toBe('final'); // an explicit confirmed zero DOES finalize
    expect(explicitZero.actualCost!.toNumber()).toBe(2050);
  });

  it('ACT-001: zero categories confirmed (a freshly opened review) is in_progress with confirmedCategories=0 and every final figure null', () => {
    const r = evaluateActualReview({
      materials: { confirmed: false, amount: null },
      labor: { confirmed: false, amount: null },
      otherExpenses: { confirmed: false, amount: null },
      overhead: { confirmed: false, amount: null },
      ...baseline,
    });
    expect(r.state).toBe('in_progress');
    expect(r.confirmedCategories).toBe(0);
    expect(r.recordedCostSoFar.isZero()).toBe(true);
    expect(r.actualCost).toBeNull();
    expect(r.profitAgainstOriginalQuote).toBeNull();
    expect(r.marginRatio).toBeNull();
    expect(r.totalVariance).toBeNull();
  });

  it('ACT-004: all four amounts supplied but one left unconfirmed still blocks finalization -- confirmed is what counts, not the presence of an amount', () => {
    const r = evaluateActualReview({
      materials: { confirmed: true, amount: d('700') },
      labor: { confirmed: true, amount: d('1200') },
      otherExpenses: { confirmed: true, amount: d('150') },
      overhead: { confirmed: false, amount: d('135') }, // an amount IS present, but confirmed=false
      ...baseline,
    });
    expect(r.state).toBe('in_progress'); // never finalizes just because every field happens to be filled
    expect(r.confirmedCategories).toBe(3); // the unconfirmed category, despite having an amount, does not count
    expect(r.actualCost).toBeNull();
    // recordedCostSoFar must also exclude the unconfirmed category's amount,
    // not just confirmedCategories -- 700+1200+150 = 2050, NOT +135 = 2185.
    expect(r.recordedCostSoFar.toNumber()).toBe(2050);
  });
});
