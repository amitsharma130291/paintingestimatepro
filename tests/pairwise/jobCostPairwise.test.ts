// Numerical-hardening initiative, section 8: pairwise mode coverage,
// sub-model B (free job-cost calculator). See
// docs/generate_pairwise_cases.js / tests/pairwise/generated-cases.json /
// PAIRWISE_COVERAGE_REPORT.md.
import { describe, it, expect } from 'vitest';
import generated from './generated-cases.json';
import { evaluateJobCost, type JobCostInputs } from '../../src/components/tools/jobCostCalculatorLogic';

const OVERHEAD_BAND: Record<string, string> = { zero: '0', normal: '15', highWarn: '60', max: '100' };
const TARGET_BAND: Record<string, string> = { zero: '0', normal: '35', nearMax: '99.9' };

type Case = (typeof generated.subModels.B_freeJobCost.generatedCases)[number];

function buildInputs(c: Case): JobCostInputs {
  return {
    materialsMode: c.materialsMode as 'lumpSum' | 'itemized',
    materialsAmount: '1000', paintGallons: '20', paintPricePerGal: '50', suppliesAmount: '0',
    laborMode: c.laborMode as 'direct' | 'hoursRate',
    laborAmount: '800', laborHours: '25', loadedHourlyRate: '32',
    travelAmount: '0', otherExpenseLines: [],
    overheadMode: c.overheadMode as 'percent' | 'flat',
    overheadPercent: OVERHEAD_BAND[c.overheadBand], overheadFlat: '300',
    targetPercent: TARGET_BAND[c.targetMarginBand],
    pricingMode: c.pricingMode as 'solveForPrice' | 'enterPrice',
    enteredPrice: '5000',
  };
}

describe('PAIRWISE-B: free job-cost calculator mode-interaction coverage', () => {
  const cases = generated.subModels.B_freeJobCost.generatedCases as Case[];

  it.each(cases.map((c, i) => [i, c] as const))('case %i: %o', (_i, c) => {
    const inputs = buildInputs(c);
    const result = evaluateJobCost(inputs);
    expect(result.state).toBe('complete');
    if (result.state !== 'complete') return;

    expect(result.cost.isFinite()).toBe(true);
    expect(result.cost.isNegative()).toBe(false);
    expect(result.overhead.isFinite()).toBe(true);
    expect(result.overhead.isNegative()).toBe(false);

    if (c.pricingMode === 'solveForPrice') {
      expect(result.price.status).toBe('unpriced');
      expect(result.price.approxPrice!.isFinite()).toBe(true);
    } else {
      // enterPrice=5000 against this fixture's cost -- just confirm a real,
      // finite, non-crashing status was reached; the exact status depends
      // on the overhead/target combination, which is exactly the
      // mode-interaction this case is exercising.
      expect(['unpriced', 'zero_price', 'below_cost', 'below_target', 'at_target', 'above_target']).toContain(result.price.status);
    }
  });
});
