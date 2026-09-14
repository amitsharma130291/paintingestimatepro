import { PEP, type Dec } from './decimal';
import { trimPaintableArea, doorPaintableArea } from './geometry';
import { wallOrCeilingHours, trimHours, doorHours, surfaceApplicationLaborCost, type SurfaceLaborLine } from './labor';
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
  const laborLines: SurfaceLaborLine[] = [];
  let laborHours = new PEP(0);

  for (const s of enabled) {
    const area = surfacePaintableArea(s.geometry);
    const hours = surfaceLaborHours(s.geometry, s.coats, s.rateOrThroughput);
    const pricing = variantPricing.get(s.paintVariantId);
    const coverage = pricing?.coveragePerGal ?? new PEP(350);
    demands.push({ paintVariantId: s.paintVariantId, rawGal: rawDemandGal(area, s.coats, s.wasteRatio, coverage) });
    laborHours = laborHours.plus(hours);
    laborLines.push({ hours, loadedHourlyRate: s.loadedHourlyRate });
  }

  const pricePerGal = new Map<string, Dec>();
  for (const [id, p] of variantPricing) pricePerGal.set(id, p.pricePerGal);
  const resolved = resolvePurchasesByVariant(demands, pricePerGal);
  const purchases: ProjectSurfacePurchase[] = resolved.map((p) => ({ paintVariantId: p.paintVariantId, rawGal: p.rawGal, purchasedGal: p.purchasedGal, cost: p.cost }));
  const materialsCost = purchases.reduce((sum, p) => sum.plus(p.cost), new PEP(0));
  const laborCost = surfaceApplicationLaborCost(laborLines);

  return { valid: true, result: { purchases, materialsCost, laborHours, laborCost } };
}
