import { PEP, ceilDecimal, type Dec } from './decimal';

/** CALCULATION_SPEC.md §4 — Paint and project aggregation. */

export function rawDemandGal(paintableAreaFt2: Dec, coats: number, wasteRatio: Dec, coverageFt2PerGal: Dec): Dec {
  return paintableAreaFt2.times(coats).times(new PEP(1).plus(wasteRatio)).dividedBy(coverageFt2PerGal);
}

export interface SurfaceDemand {
  paintVariantId: string;
  rawGal: Dec;
}

/** Group raw demand by variant (sum FIRST across every room/surface for
 * that variant), THEN ceiling once per variant — never per surface, never
 * per room. Different colors/sheens never pool, even at identical demand. */
export function aggregateRawDemandByVariant(demands: SurfaceDemand[]): Map<string, Dec> {
  const totals = new Map<string, Dec>();
  for (const d of demands) {
    totals.set(d.paintVariantId, (totals.get(d.paintVariantId) ?? new PEP(0)).plus(d.rawGal));
  }
  return totals;
}

export function purchasedGallons(totalRawGal: Dec): number {
  return ceilDecimal(totalRawGal).toNumber();
}

export interface VariantPurchase {
  paintVariantId: string;
  rawGal: Dec;
  purchasedGal: number;
  pricePerGal: Dec;
  cost: Dec;
}

export function resolvePurchasesByVariant(
  demands: SurfaceDemand[],
  pricePerGal: Map<string, Dec>
): VariantPurchase[] {
  const totals = aggregateRawDemandByVariant(demands);
  const result: VariantPurchase[] = [];
  for (const [paintVariantId, rawGal] of totals) {
    const purchasedGal = purchasedGallons(rawGal);
    const price = pricePerGal.get(paintVariantId) ?? new PEP(0);
    result.push({ paintVariantId, rawGal, purchasedGal, pricePerGal: price, cost: price.times(purchasedGal) });
  }
  return result;
}
