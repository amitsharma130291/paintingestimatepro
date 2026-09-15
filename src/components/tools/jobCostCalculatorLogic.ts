// Pure, testable logic for the free job-cost calculator (tool-specs/02).
// Completes the materialsMode (lumpSum|itemized) and laborMode
// (direct|hoursRate) toggles and a real otherExpenseLines list, which the
// prior simplified build reduced to single flat fields.
import type { Dec } from '../../engine/decimal';
import { parseDecimalField } from '../../engine/parse';
import { directCost, overheadAmount, estimatedJobCost, otherExpensesTotal } from '../../engine/cost';
import { evaluatePrice } from '../../engine/pricing';
import type { PriceResult } from '../../engine/types';

export type MaterialsMode = 'lumpSum' | 'itemized';
export type LaborMode = 'direct' | 'hoursRate';
export type OverheadMode = 'percent' | 'flat';
export type PricingMode = 'solveForPrice' | 'enterPrice';

export interface OtherExpenseLine {
  id: string;
  description: string;
  amount: string;
}

export interface JobCostInputs {
  materialsMode: MaterialsMode;
  materialsAmount: string;
  paintGallons: string;
  paintPricePerGal: string;
  suppliesAmount: string;
  laborMode: LaborMode;
  laborAmount: string;
  laborHours: string;
  loadedHourlyRate: string;
  travelAmount: string;
  otherExpenseLines: OtherExpenseLine[];
  overheadMode: OverheadMode;
  overheadPercent: string;
  overheadFlat: string;
  targetPercent: string;
  pricingMode: PricingMode;
  enteredPrice: string;
}

export type JobCostResult =
  | { state: 'incomplete'; errors: string[] }
  | { state: 'invalid'; errors: string[] }
  | {
      state: 'complete';
      errors: [];
      materials: Dec;
      labor: Dec;
      otherExpenses: Dec;
      directCostValue: Dec;
      overhead: Dec;
      cost: Dec;
      price: PriceResult;
    };

/** tool-specs/02: "At first render show empty guidance until the user
 * supplies/confirms cost data... Only active modes contribute; missing
 * active inputs block results... Changing modes never blends old hidden
 * values" — every branch below reads ONLY the fields for the currently
 * active mode; the inactive mode's stale text never contributes. */
export function evaluateJobCost(inputs: JobCostInputs): JobCostResult {
  const errors: string[] = [];
  let missing = false;

  // Materials (active mode only)
  let materials: Dec | null = null;
  if (inputs.materialsMode === 'lumpSum') {
    const p = parseDecimalField(inputs.materialsAmount);
    if (p.kind === 'missing') missing = true;
    else if (p.kind === 'invalid') errors.push(`Materials: ${p.message}`);
    else materials = p.value;
  } else {
    const pGal = parseDecimalField(inputs.paintGallons);
    const pPrice = parseDecimalField(inputs.paintPricePerGal);
    const pSupplies = parseDecimalField(inputs.suppliesAmount || '0');
    if (pGal.kind === 'missing' || pPrice.kind === 'missing') missing = true;
    if (pGal.kind === 'invalid') errors.push(`Paint gallons: ${pGal.message}`);
    if (pPrice.kind === 'invalid') errors.push(`Paint price/gal: ${pPrice.message}`);
    if (pSupplies.kind === 'invalid') errors.push(`Supplies: ${pSupplies.message}`);
    if (pGal.kind === 'valid' && pPrice.kind === 'valid' && pSupplies.kind === 'valid') {
      materials = pGal.value.times(pPrice.value).plus(pSupplies.value);
    }
  }

  // Labor (active mode only)
  let labor: Dec | null = null;
  if (inputs.laborMode === 'direct') {
    const p = parseDecimalField(inputs.laborAmount);
    if (p.kind === 'missing') missing = true;
    else if (p.kind === 'invalid') errors.push(`Labor: ${p.message}`);
    else labor = p.value;
  } else {
    const pHours = parseDecimalField(inputs.laborHours);
    const pRate = parseDecimalField(inputs.loadedHourlyRate);
    if (pHours.kind === 'missing' || pRate.kind === 'missing') missing = true;
    if (pHours.kind === 'invalid') errors.push(`Labor hours: ${pHours.message}`);
    if (pRate.kind === 'invalid') errors.push(`Loaded hourly rate: ${pRate.message}`);
    if (pHours.kind === 'valid' && pRate.kind === 'valid') labor = pHours.value.times(pRate.value);
  }

  // Travel + other expense lines (optional additive — blank defaults to 0, never blocks)
  const pTravel = parseDecimalField(inputs.travelAmount || '0');
  if (pTravel.kind === 'invalid') errors.push(`Travel: ${pTravel.message}`);
  const lineAmounts: Dec[] = [];
  for (const line of inputs.otherExpenseLines) {
    if (line.description.trim() === '' && line.amount.trim() === '') continue; // untouched line, ignored
    const pAmount = parseDecimalField(line.amount || '0');
    if (pAmount.kind !== 'valid') {
      errors.push(pAmount.kind === 'invalid' ? `Other expense "${line.description || '(untitled)'}": ${pAmount.message}` : `Other expense "${line.description || '(untitled)'}" needs an amount.`);
      continue;
    }
    lineAmounts.push(pAmount.value);
  }

  // Target margin (always required-active)
  const pTargetPct = parseDecimalField(inputs.targetPercent);
  if (pTargetPct.kind === 'missing') missing = true;
  else if (pTargetPct.kind === 'invalid') errors.push(`Target margin: ${pTargetPct.message}`);

  // Overhead (active mode only)
  let overheadInput: Dec | null = null;
  if (inputs.overheadMode === 'percent') {
    const pOverheadPct = parseDecimalField(inputs.overheadPercent);
    if (pOverheadPct.kind === 'missing') missing = true;
    else if (pOverheadPct.kind === 'invalid') errors.push(`Overhead %: ${pOverheadPct.message}`);
    else overheadInput = pOverheadPct.value;
  } else {
    const pOverheadFlat = parseDecimalField(inputs.overheadFlat || '0');
    if (pOverheadFlat.kind !== 'valid') errors.push(pOverheadFlat.kind === 'invalid' ? `Overhead: ${pOverheadFlat.message}` : 'Overhead amount is required.');
    else overheadInput = pOverheadFlat.value;
  }

  if (missing) return { state: 'incomplete', errors };
  if (errors.length > 0 || materials === null || labor === null || pTravel.kind !== 'valid' || pTargetPct.kind !== 'valid' || overheadInput === null) {
    return { state: 'invalid', errors };
  }

  const targetRatio = pTargetPct.value.dividedBy(100);
  if (targetRatio.greaterThanOrEqualTo(1) || targetRatio.isNegative()) {
    return { state: 'invalid', errors: ['Target margin must be between 0% and 99%.'] };
  }

  const otherExpenses = otherExpensesTotal([{ amount: pTravel.value }, ...lineAmounts.map((amount) => ({ amount }))]);
  const dc = directCost(materials, labor, otherExpenses);
  const oh = inputs.overheadMode === 'percent' ? overheadAmount(dc, overheadInput.dividedBy(100)) : overheadInput;
  const cost = estimatedJobCost(dc, oh);

  let priceInput: Dec | null = null;
  if (inputs.pricingMode === 'enterPrice' && inputs.enteredPrice.trim() !== '') {
    // V5-07/CORE-021 (related path): the same selling-total precision rule
    // applies here as in the Pro estimate summary — a raw-entered price
    // uses at most two fractional digits.
    const pEntered = parseDecimalField(inputs.enteredPrice, { maxFractionDigits: 2 });
    if (pEntered.kind === 'invalid') return { state: 'invalid', errors: [`Price: ${pEntered.message}`] };
    if (pEntered.kind === 'valid') priceInput = pEntered.value;
  }

  const price = evaluatePrice({ cost, price: priceInput, targetMarginRatio: targetRatio });
  return { state: 'complete', errors: [], materials, labor, otherExpenses, directCostValue: dc, overhead: oh, cost, price };
}

export function newOtherExpenseLine(id: string): OtherExpenseLine {
  return { id, description: '', amount: '' };
}
