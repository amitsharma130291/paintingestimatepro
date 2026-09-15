import { PEP, type Dec } from './decimal';
import { MAX_AGGREGATE_MONETARY } from './parse';

/**
 * DATA_CONTRACT.md "Actual review" + CHANGELOG v2.1: margin is gated on
 * baselinePrice > 0 REGARDLESS of profit's sign — a loss must still show a
 * real negative margin, never be suppressed. baselinePrice = 0 yields
 * margin = null (undefined) while still retaining the loss amount. A
 * missing baseline price is invalid for an issued baseline (reject it
 * upstream; this function assumes a resolved Dec, never null, is passed).
 */

export interface ActualCategory {
  confirmed: boolean;
  amount: Dec | null;
}

export interface ActualReviewInput {
  materials: ActualCategory;
  labor: ActualCategory;
  otherExpenses: ActualCategory;
  overhead: ActualCategory;
  baselinePrice: Dec; // the original issued proposedPrice; must be >= 0
  baselineCost: Dec; // the original issued estimatedJobCost
}

export interface ActualReviewResult {
  /** AGG-005 / DECISIONS.md #9: 'out_of_supported_range' when all four
   * categories are confirmed (each individually within its own field
   * bound) but their SUM exceeds the supported aggregate ceiling --
   * distinct from 'in_progress' (not all categories confirmed yet) and
   * never silently reported as 'final' with a huge-but-technically-
   * correct total. */
  state: 'in_progress' | 'final' | 'out_of_supported_range';
  confirmedCategories: number;
  recordedCostSoFar: Dec; // sum of confirmed categories only
  actualCost: Dec | null; // only set when state === 'final'
  profitAgainstOriginalQuote: Dec | null;
  marginRatio: Dec | null;
  totalVariance: Dec | null;
}

function categoryValue(c: ActualCategory): Dec | null {
  return c.confirmed && c.amount !== null ? c.amount : null;
}

export function evaluateActualReview(input: ActualReviewInput): ActualReviewResult {
  const categories = [input.materials, input.labor, input.otherExpenses, input.overhead];
  const confirmedCategories = categories.filter((c) => c.confirmed && c.amount !== null).length;

  const recordedCostSoFar = categories.reduce((sum, c) => {
    const v = categoryValue(c);
    return v ? sum.plus(v) : sum;
  }, new PEP(0));

  if (confirmedCategories < 4) {
    return {
      state: 'in_progress',
      confirmedCategories,
      recordedCostSoFar,
      actualCost: null,
      profitAgainstOriginalQuote: null,
      marginRatio: null,
      totalVariance: null,
    };
  }

  // AGG-005: each category's own amount already passed its individual
  // field bound upstream (ProApp.tsx's deriveActualCategory), but four
  // categories each within MAX_AGGREGATE_MONETARY can still sum past it.
  if (recordedCostSoFar.greaterThan(MAX_AGGREGATE_MONETARY)) {
    return {
      state: 'out_of_supported_range',
      confirmedCategories,
      recordedCostSoFar,
      actualCost: null,
      profitAgainstOriginalQuote: null,
      marginRatio: null,
      totalVariance: null,
    };
  }

  const actualCost = recordedCostSoFar;
  const profit = input.baselinePrice.minus(actualCost);
  const marginRatio = input.baselinePrice.greaterThan(0) ? profit.dividedBy(input.baselinePrice) : null;
  const totalVariance = actualCost.minus(input.baselineCost);

  return {
    state: 'final',
    confirmedCategories,
    recordedCostSoFar,
    actualCost,
    profitAgainstOriginalQuote: profit,
    marginRatio,
    totalVariance,
  };
}
