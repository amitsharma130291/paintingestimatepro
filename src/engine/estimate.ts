import { PEP, type Dec } from './decimal';
import { trimPaintableArea, doorPaintableArea } from './geometry';
import { wallOrCeilingHours, trimHours, doorHours } from './labor';
import { rawDemandGal, resolvePurchasesByVariant, type SurfaceDemand } from './paint';

/**
 * CALCULATION_SPEC.md §3-5 project-level surface aggregator. Every room's
 * wall/ceiling AND every standalone trim/door surface goes through the same
 * path here — there is exactly one place that decides how paint demand and
 * labor hours are computed per surface kind, so a room-derived wall and a
 * standalone wall (if that ever existed) can never silently diverge. This
 * function does not duplicate the geometry/labor/paint formulas themselves;
 * it only dispatches to the existing pure primitives and pools the results.
 */

export type SurfaceKind = 'wall' | 'ceiling' | 'trim' | 'door';

export type SurfaceGeometryInput =
  | { kind: 'wall' | 'ceiling'; wallOrCeilingAreaFt2: Dec }
  | { kind: 'trim'; trimLengthFt: Dec; developedWidthFt: Dec }
  | { kind: 'door'; doorCount: number; doorWidthFt: Dec; doorHeightFt: Dec; paintedSides: 1 | 2 };

export interface ProjectSurface {
  id: string;
  enabled: boolean;
  /** Computed upstream (parsing + geometry validity). An enabled-but-invalid
   * surface must block the whole project — never silently drop it. */
  valid: boolean;
  geometry: SurfaceGeometryInput;
  paintVariantId: string;
  coats: number;
  wasteRatio: Dec;
  loadedHourlyRate: Dec;
  /** Wall/ceiling/trim: throughput (area or linear ft per hour per coat).
   * Door: hours per side per coat. Same slot, kind decides interpretation —
   * mirrors how CALCULATION_SPEC itself defines "applicationHoursPerUnit". */
  rateOrThroughput: Dec;
}

export interface VariantPricing {
  coveragePerGal: Dec;
  pricePerGal: Dec;
}

export function surfacePaintableArea(g: SurfaceGeometryInput): Dec {
  switch (g.kind) {
    case 'wall':
    case 'ceiling':
      return g.wallOrCeilingAreaFt2;
    case 'trim':
      return trimPaintableArea(g.trimLengthFt, g.developedWidthFt);
    case 'door':
      return doorPaintableArea(g.doorCount, g.doorWidthFt, g.doorHeightFt, g.paintedSides);
  }
}

export function surfaceLaborHours(g: SurfaceGeometryInput, coats: number, rateOrThroughput: Dec): Dec {
  switch (g.kind) {
    case 'wall':
    case 'ceiling':
      return wallOrCeilingHours(g.wallOrCeilingAreaFt2, coats, rateOrThroughput);
    case 'trim':
      return trimHours(g.trimLengthFt, coats, rateOrThroughput);
    case 'door':
      return doorHours(g.doorCount, g.paintedSides, coats, rateOrThroughput);
  }
}

/** NUM-DEC-002: computes a surface's OWN labor cost directly from its
 * geometry/rate inputs, in one fused multiply-then-divide, rather than by
 * multiplying the separately-computed `surfaceLaborHours` value by the
 * hourly rate. For wall/ceiling/trim, `hours = area*coats/throughput` can
 * be a repeating decimal (e.g. 6277/30) that a later multiply by rate
 * would have exactly cancelled (e.g. rate=39=3*13 exactly cancels the 3 in
 * 30) — but only if that cancellation happens in ONE division, not after
 * `hours` has already been rounded to the engine's precision. Found via
 * 205,000-fixture differential fuzzing against an independent Python
 * decimal oracle: two fixtures still diverged by a cent from the true
 * (exact-rational) total even after NUM-DEC-001 raised precision from 50
 * to 100 — no fixed precision fully eliminates this, since it's about
 * *order of operations*, not headroom. Door has no such division in the
 * first place (hoursPerSidePerCoat is a flat multiplier), so its cost is
 * unaffected either way. */
export function surfaceLaborCost(g: SurfaceGeometryInput, coats: number, rateOrThroughput: Dec, loadedHourlyRate: Dec): Dec {
  switch (g.kind) {
    case 'wall':
    case 'ceiling':
      return g.wallOrCeilingAreaFt2.times(coats).times(loadedHourlyRate).dividedBy(rateOrThroughput);
    case 'trim':
      return g.trimLengthFt.times(coats).times(loadedHourlyRate).dividedBy(rateOrThroughput);
    case 'door':
      return doorHours(g.doorCount, g.paintedSides, coats, rateOrThroughput).times(loadedHourlyRate);
  }
}

export interface ProjectSurfacePurchase {
  paintVariantId: string;
  rawGal: Dec;
  purchasedGal: number;
  cost: Dec;
}

export interface ProjectAggregateResult {
  purchases: ProjectSurfacePurchase[];
  materialsCost: Dec;
  laborHours: Dec;
  laborCost: Dec;
}

export interface ProjectAggregateOutcome {
  valid: boolean;
  result: ProjectAggregateResult | null;
}

/** Enabled-and-invalid surfaces block the whole project (return valid:false,
 * result:null — never a partial total). Disabled surfaces, valid or not,
 * are excluded before anything else runs, so a stale/garbage disabled
 * surface can never leak into demand, labor, or cost. Zero enabled surfaces
 * is treated the same as "invalid" here — callers distinguish "no surfaces
 * yet" from "some surface is broken" using their own missing/invalid state,
 * not this function's boolean. */
export function aggregateProjectSurfaces(surfaces: ProjectSurface[], variantPricing: Map<string, VariantPricing>): ProjectAggregateOutcome {
  const enabled = surfaces.filter((s) => s.enabled);
  if (enabled.length === 0) return { valid: false, result: null };
  if (enabled.some((s) => !s.valid)) return { valid: false, result: null };

  const demands: SurfaceDemand[] = [];
  let laborHours = new PEP(0);
  let laborCost = new PEP(0);

  for (const s of enabled) {
    const area = surfacePaintableArea(s.geometry);
    const hours = surfaceLaborHours(s.geometry, s.coats, s.rateOrThroughput);
    const cost = surfaceLaborCost(s.geometry, s.coats, s.rateOrThroughput, s.loadedHourlyRate);
    const pricing = variantPricing.get(s.paintVariantId);
    const coverage = pricing?.coveragePerGal ?? new PEP(350);
    demands.push({ paintVariantId: s.paintVariantId, rawGal: rawDemandGal(area, s.coats, s.wasteRatio, coverage) });
    laborHours = laborHours.plus(hours);
    laborCost = laborCost.plus(cost);
  }

  const pricePerGal = new Map<string, Dec>();
  for (const [id, p] of variantPricing) pricePerGal.set(id, p.pricePerGal);
  const resolved = resolvePurchasesByVariant(demands, pricePerGal);
  const purchases: ProjectSurfacePurchase[] = resolved.map((p) => ({ paintVariantId: p.paintVariantId, rawGal: p.rawGal, purchasedGal: p.purchasedGal, cost: p.cost }));
  const materialsCost = purchases.reduce((sum, p) => sum.plus(p.cost), new PEP(0));

  return { valid: true, result: { purchases, materialsCost, laborHours, laborCost } };
}
