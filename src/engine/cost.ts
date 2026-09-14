import { PEP, type Dec } from './decimal';

/** CALCULATION_SPEC.md §5 — materials, overhead, direct/total job cost. */

export type SuppliesAllowanceMode = 'none' | 'flat' | 'paintPercent';

export interface SuppliesAllowanceInput {
  mode: SuppliesAllowanceMode;
  flatAmount?: Dec;
  paintPercentRatio?: Dec;
}

/** Only the active mode contributes — never both, never a stale inactive
 * value (mutation check: "Apply supplies percent to all materials"). */
export function suppliesAllowance(input: SuppliesAllowanceInput, paintCost: Dec): Dec {
  switch (input.mode) {
    case 'none':
      return new PEP(0);
    case 'flat':
      return input.flatAmount ?? new PEP(0);
    case 'paintPercent':
      return paintCost.times(input.paintPercentRatio ?? new PEP(0));
  }
}

export function otherMaterialCost(lines: { quantity: Dec; unitCost: Dec }[]): Dec {
  return lines.reduce((sum, l) => sum.plus(l.quantity.times(l.unitCost)), new PEP(0));
}

export function materialsTotal(paintCost: Dec, otherMaterialsCost: Dec, allowance: Dec): Dec {
  return paintCost.plus(otherMaterialsCost).plus(allowance);
}

export function otherExpensesTotal(lines: { amount: Dec }[]): Dec {
  return lines.reduce((sum, l) => sum.plus(l.amount), new PEP(0));
}

export function directCost(materials: Dec, labor: Dec, otherExpenses: Dec): Dec {
  return materials.plus(labor).plus(otherExpenses);
}

/** Single v1 allocation method: overhead = directCost * overheadRatio. */
export function overheadAmount(directCostValue: Dec, overheadRatio: Dec): Dec {
  return directCostValue.times(overheadRatio);
}

export function estimatedJobCost(directCostValue: Dec, overhead: Dec): Dec {
  return directCostValue.plus(overhead);
}
