// JOB-005/006/007/008 + the confirmed JOB-001/002 missing-vs-zero rule,
// for the free job-cost calculator's completed materialsMode/laborMode
// logic (src/components/tools/jobCostCalculatorLogic.ts).
import { describe, it, expect } from 'vitest';
import { evaluateJobCost, newOtherExpenseLine, type JobCostInputs } from '../../src/components/tools/jobCostCalculatorLogic';

function baseInputs(overrides: Partial<JobCostInputs> = {}): JobCostInputs {
  return {
    materialsMode: 'lumpSum', materialsAmount: '',
    paintGallons: '', paintPricePerGal: '', suppliesAmount: '',
    laborMode: 'direct', laborAmount: '',
    laborHours: '', loadedHourlyRate: '',
    travelAmount: '', otherExpenseLines: [],
    overheadMode: 'percent', overheadPercent: '15', overheadFlat: '',
    targetPercent: '35',
    pricingMode: 'solveForPrice', enteredPrice: '',
    ...overrides,
  };
}

describe('tool-specs/02 "original brief acceptance" fixture — independently derived expected values, not computed by the function under test', () => {
  it('42hr*$32 labor (hoursRate) + 22gal*$42 + $180 supplies (itemized) + $100 travel + $75 other -> direct $2623, overhead $393.45, total $3016.45, approx/min $4640.69/$4640.70', () => {
    const inputs = baseInputs({
      materialsMode: 'itemized', paintGallons: '22', paintPricePerGal: '42', suppliesAmount: '180',
      laborMode: 'hoursRate', laborHours: '42', loadedHourlyRate: '32',
      travelAmount: '100',
      otherExpenseLines: [{ id: '1', description: 'Other', amount: '75' }],
      overheadMode: 'percent', overheadPercent: '15',
      targetPercent: '35',
    });
    const result = evaluateJobCost(inputs);
    expect(result.state).toBe('complete');
    if (result.state !== 'complete') return;
    expect(result.materials.toFixed(2)).toBe('1104.00'); // 22*42 + 180
    expect(result.labor.toFixed(2)).toBe('1344.00'); // 42*32
    expect(result.otherExpenses.toFixed(2)).toBe('175.00'); // 100 travel + 75 other
    expect(result.directCostValue.toFixed(2)).toBe('2623.00');
    expect(result.overhead.toFixed(2)).toBe('393.45');
    expect(result.cost.toFixed(2)).toBe('3016.45');
    expect(result.price.approxPrice!.toFixed(2)).toBe('4640.69');
    expect(result.price.minimumTargetPrice!.toFixed(2)).toBe('4640.70');
  });
});

describe('materialsMode: lumpSum vs itemized never blend stale values from the inactive mode', () => {
  it('lumpSum mode ignores itemized fields even if they carry stale text', () => {
    const inputs = baseInputs({
      materialsMode: 'lumpSum', materialsAmount: '500',
      paintGallons: '999', paintPricePerGal: '999', suppliesAmount: '999', // stale, must be ignored
      laborMode: 'direct', laborAmount: '200',
    });
    const result = evaluateJobCost(inputs);
    expect(result.state).toBe('complete');
    if (result.state === 'complete') expect(result.materials.toFixed(2)).toBe('500.00');
  });

  it('itemized mode ignores the lumpSum field even if it carries stale text', () => {
    const inputs = baseInputs({
      materialsMode: 'itemized', paintGallons: '10', paintPricePerGal: '40', suppliesAmount: '50',
      materialsAmount: '999999', // stale, must be ignored
      laborMode: 'direct', laborAmount: '200',
    });
    const result = evaluateJobCost(inputs);
    expect(result.state).toBe('complete');
    if (result.state === 'complete') expect(result.materials.toFixed(2)).toBe('450.00'); // 10*40+50
  });

  it('itemized mode blocks (incomplete) when gallons is blank, even though lumpSum has stale data', () => {
    const inputs = baseInputs({ materialsMode: 'itemized', paintGallons: '', paintPricePerGal: '40', materialsAmount: '500', laborMode: 'direct', laborAmount: '200' });
    expect(evaluateJobCost(inputs).state).toBe('incomplete');
  });
});

describe('laborMode: direct vs hoursRate never blend stale values', () => {
  it('hoursRate mode ignores the direct field even if it carries stale text', () => {
    const inputs = baseInputs({ materialsMode: 'lumpSum', materialsAmount: '100', laborMode: 'hoursRate', laborHours: '10', loadedHourlyRate: '30', laborAmount: '99999' });
    const result = evaluateJobCost(inputs);
    expect(result.state).toBe('complete');
    if (result.state === 'complete') expect(result.labor.toFixed(2)).toBe('300.00');
  });
});

describe('JOB-001/002 regression: missing required active fields block a result — never a false $0.00 "complete"', () => {
  it('a completely blank form (first render) is incomplete, not a priced $0.00 result', () => {
    expect(evaluateJobCost(baseInputs()).state).toBe('incomplete');
  });

  it('materials alone filled (labor still blank) stays incomplete', () => {
    expect(evaluateJobCost(baseInputs({ materialsAmount: '500' })).state).toBe('incomplete');
  });

  it('explicit zero materials AND labor is a valid, complete (not incomplete) zero-cost scenario', () => {
    const result = evaluateJobCost(baseInputs({ materialsAmount: '0', laborAmount: '0' }));
    expect(result.state).toBe('complete');
    if (result.state === 'complete') {
      expect(result.materials.isZero()).toBe(true);
      expect(result.cost.isZero()).toBe(true);
    }
  });
});

describe('otherExpenseLines: a real list, not a single flat field', () => {
  it('sums multiple named expense lines plus travel', () => {
    const inputs = baseInputs({
      materialsAmount: '0', laborAmount: '0',
      travelAmount: '50',
      otherExpenseLines: [newOtherExpenseLine('a'), { id: 'b', description: 'Permit', amount: '25' }, { id: 'c', description: 'Disposal', amount: '15' }],
    });
    const result = evaluateJobCost(inputs);
    expect(result.state).toBe('complete');
    // newOtherExpenseLine('a') is untouched (blank description+amount) -> ignored, not an error
    if (result.state === 'complete') expect(result.otherExpenses.toFixed(2)).toBe('90.00'); // 50 + 25 + 15
  });

  it('a touched-but-invalid expense line blocks the result with a clear message', () => {
    const inputs = baseInputs({ materialsAmount: '0', laborAmount: '0', otherExpenseLines: [{ id: 'a', description: 'Bad', amount: 'abc' }] });
    const result = evaluateJobCost(inputs);
    expect(result.state).toBe('invalid');
    expect(result.errors[0]).toContain('Bad');
  });
});

describe('overheadMode: percent vs flat never blend', () => {
  it('flat overhead ignores the percent field', () => {
    const inputs = baseInputs({ materialsAmount: '1000', laborAmount: '0', overheadMode: 'flat', overheadFlat: '50', overheadPercent: '999' });
    const result = evaluateJobCost(inputs);
    expect(result.state).toBe('complete');
    if (result.state === 'complete') expect(result.overhead.toFixed(2)).toBe('50.00');
  });
});

describe('Pricing: unpriced vs zero-price vs below-cost, forwarded from the shared pricing engine unchanged', () => {
  it('solveForPrice mode never has a price entered -> "unpriced" status is impossible here (always shows approx/min target)', () => {
    const result = evaluateJobCost(baseInputs({ materialsAmount: '100', laborAmount: '0' }));
    expect(result.state).toBe('complete');
    if (result.state === 'complete') {
      expect(result.price.approxPrice).not.toBeNull();
      expect(result.price.minimumTargetPrice).not.toBeNull();
    }
  });

  it('enterPrice mode with no price entered yet reports unpriced', () => {
    const result = evaluateJobCost(baseInputs({ materialsAmount: '100', laborAmount: '0', pricingMode: 'enterPrice', enteredPrice: '' }));
    expect(result.state).toBe('complete');
    if (result.state === 'complete') expect(result.price.status).toBe('unpriced');
  });

  it('enterPrice mode with an explicit price below cost shows negative profit, not a suppressed/clamped one', () => {
    const result = evaluateJobCost(baseInputs({ materialsAmount: '1000', laborAmount: '0', pricingMode: 'enterPrice', enteredPrice: '500' }));
    expect(result.state).toBe('complete');
    if (result.state === 'complete') {
      expect(result.price.status).toBe('below_cost');
      expect(result.price.profit!.isNegative()).toBe(true);
    }
  });
});

describe('V5-07/CORE-021 (related path): an entered price enforces at most two fractional digits, same rule as Pro', () => {
  it('rejects three fractional digits (12.005)', () => {
    const result = evaluateJobCost(baseInputs({ materialsAmount: '100', laborAmount: '0', pricingMode: 'enterPrice', enteredPrice: '12.005' }));
    expect(result.state).toBe('invalid');
  });

  it('accepts exactly two fractional digits (12.01)', () => {
    const result = evaluateJobCost(baseInputs({ materialsAmount: '100', laborAmount: '0', pricingMode: 'enterPrice', enteredPrice: '12.01' }));
    expect(result.state).toBe('complete');
  });
});

describe('CORE-006: an omitted optional direct-expense field in a NEW estimate defaults to explicit zero, never blocking', () => {
  it('a blank travelAmount with everything else valid reaches complete with $0 travel/other-expenses contribution', () => {
    const result = evaluateJobCost(baseInputs({ materialsAmount: '100', laborAmount: '0', travelAmount: '' }));
    expect(result.state).toBe('complete');
    if (result.state === 'complete') expect(result.otherExpenses.isZero()).toBe(true);
  });

  it('an untouched (blank description AND amount) other-expense line is silently ignored, not a missing-field block', () => {
    const result = evaluateJobCost(baseInputs({ materialsAmount: '100', laborAmount: '0', otherExpenseLines: [newOtherExpenseLine('untouched')] }));
    expect(result.state).toBe('complete');
  });
});
