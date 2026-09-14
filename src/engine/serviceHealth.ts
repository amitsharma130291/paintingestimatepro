import { PEP, type Dec } from './decimal';
import { evaluatePrice } from './pricing';
import type { PriceResult } from './types';

/** CALCULATION_SPEC.md §8 — Service-unit cost model (Price Book Health).
 * Consumption-based: NO whole-gallon rounding here (that's a real-project
 * purchasing concern, §4) — a service's modeled cost is a fractional
 * per-unit consumption rate. */

export type ServiceKind = 'wall' | 'ceiling' | 'trim' | 'door';

export interface ServiceUnitInput {
  kind: ServiceKind;
  areaPerUnit: Dec; // wall/ceiling: 1 ft²; trim: developedWidthFt (1 linear-ft basis); door: w*h*sides (1 door basis)
  coats: number;
  wasteRatio: Dec;
  coverageFt2PerGal: Dec;
  pricePerGal: Dec;
  applicationHoursPerUnit: Dec; // wall/ceiling: coats/throughput; trim: coats/linearThroughput; door: sides*coats*hoursPerSidePerCoat
  additionalLaborHoursPerUnit: Dec;
  loadedHourlyRate: Dec;
  suppliesCostPerUnit: Dec;
  directExpensePerUnit: Dec;
  overheadRatio: Dec;
}

export interface ServiceUnitCost {
  paintConsumptionCostPerUnit: Dec;
  materialsPerUnit: Dec;
  laborHoursPerUnit: Dec;
  laborCostPerUnit: Dec;
  directCostPerUnit: Dec;
  overheadPerUnit: Dec;
  modeledCostPerUnit: Dec;
}

export function computeServiceUnitCost(input: ServiceUnitInput): ServiceUnitCost {
  const paintConsumptionCostPerUnit = input.areaPerUnit
    .times(input.coats)
    .times(new PEP(1).plus(input.wasteRatio))
    .dividedBy(input.coverageFt2PerGal)
    .times(input.pricePerGal);
  const materialsPerUnit = paintConsumptionCostPerUnit.plus(input.suppliesCostPerUnit);
  const laborHoursPerUnit = input.applicationHoursPerUnit.plus(input.additionalLaborHoursPerUnit);
  const laborCostPerUnit = laborHoursPerUnit.times(input.loadedHourlyRate);
  const directCostPerUnit = materialsPerUnit.plus(laborCostPerUnit).plus(input.directExpensePerUnit);
  const overheadPerUnit = directCostPerUnit.times(input.overheadRatio);
  const modeledCostPerUnit = directCostPerUnit.plus(overheadPerUnit);
  return { paintConsumptionCostPerUnit, materialsPerUnit, laborHoursPerUnit, laborCostPerUnit, directCostPerUnit, overheadPerUnit, modeledCostPerUnit };
}

export interface ServiceHealthRow {
  serviceId: string;
  unitCost: ServiceUnitCost | null; // null when required assumptions are missing -> "incomplete", never a fabricated low/zero cost
  price: PriceResult | null;
}

export function evaluateServiceHealth(
  serviceId: string,
  unitCost: ServiceUnitCost | null,
  currentSellingPrice: Dec | null,
  targetMarginRatio: Dec
): ServiceHealthRow {
  if (unitCost === null) return { serviceId, unitCost: null, price: null };
  const price = evaluatePrice({ cost: unitCost.modeledCostPerUnit, price: currentSellingPrice, targetMarginRatio });
  return { serviceId, unitCost, price };
}
