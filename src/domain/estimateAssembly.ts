import { PEP, type Dec } from '../engine/decimal';
import { parseDecimalField, isPositiveDivisor } from '../engine/parse';
import { grossWallArea, ceilingArea, netWallArea, quickOpeningArea, detailedOpeningArea } from '../engine/geometry';
import { aggregateProjectSurfaces, type ProjectSurface, type ProjectAggregateResult, type VariantPricing, type SurfaceGeometryInput } from '../engine/estimate';
import { materialsTotal, otherMaterialCost, otherExpensesTotal, directCost, overheadAmount, estimatedJobCost, suppliesAllowance } from '../engine/cost';
import { evaluatePrice } from '../engine/pricing';
import type { PriceResult } from '../engine/types';
import type { EstimateRevision, Room, Surface } from './entities';

/**
 * Domain-layer glue: the ONE place that turns persisted Room/Surface string
 * fields plus a RateSnapshot into the pure engine calculation. UI code must
 * call this rather than re-deriving geometry/labor/cost formulas itself —
 * that duplication is exactly what let the earlier prototype UI silently
 * diverge from the spec (single variant per room, no trim/door support).
 */

export interface ProjectEstimateAssembly {
  calculationState: 'complete' | 'incomplete' | 'invalid';
  reasons: string[];
  aggregate: ProjectAggregateResult | null;
  materials: Dec | null;
  laborCost: Dec | null;
  directCost: Dec | null;
  overhead: Dec | null;
  jobCost: Dec | null;
  price: PriceResult | null;
  suggestedPrice: Dec | null;
  effectivePrice: Dec | null;
}

function incompleteResult(reasons: string[]): ProjectEstimateAssembly {
  return { calculationState: 'incomplete', reasons, aggregate: null, materials: null, laborCost: null, directCost: null, overhead: null, jobCost: null, price: null, suggestedPrice: null, effectivePrice: null };
}

function invalidResult(reasons: string[]): ProjectEstimateAssembly {
  return { calculationState: 'invalid', reasons, aggregate: null, materials: null, laborCost: null, directCost: null, overhead: null, jobCost: null, price: null, suggestedPrice: null, effectivePrice: null };
}

/** Room-derived geometry for a wall or ceiling surface whose measurementMode
 * is 'roomDerived'. Returns null (incomplete) if the room's own dimensions
 * are not yet filled in, or `valid:false` if openings exceed gross area. */
function roomDerivedGeometry(room: Room, kind: 'wall' | 'ceiling'): { state: 'missing' | 'invalid' | 'ok'; area?: Dec } {
  const length = parseDecimalField(room.lengthFt);
  const width = parseDecimalField(room.widthFt);
  const height = parseDecimalField(room.heightFt);
  if (length.kind === 'missing' || width.kind === 'missing' || height.kind === 'missing') return { state: 'missing' };
  if (length.kind === 'invalid' || width.kind === 'invalid' || height.kind === 'invalid') return { state: 'invalid' };
  if (!length.value.greaterThan(0) || !width.value.greaterThan(0) || !height.value.greaterThan(0)) return { state: 'invalid' };

  if (kind === 'ceiling') return { state: 'ok', area: ceilingArea(length.value, width.value) };

  const gross = grossWallArea(length.value, width.value, height.value);
  if (!room.deductionEnabled) return { state: 'ok', area: gross };

  let openingArea: Dec;
  if (room.openingMode === 'quick') {
    const doorArea = parseDecimalField(room.quick.doorAreaEach);
    const windowArea = parseDecimalField(room.quick.windowAreaEach);
    if (doorArea.kind !== 'valid' || windowArea.kind !== 'valid') return { state: 'invalid' };
    openingArea = quickOpeningArea(room.quick.doorCount, doorArea.value, room.quick.windowCount, windowArea.value);
  } else {
    const parsed = room.openings.map((o) => ({ widthFt: parseDecimalField(o.widthFt), heightFt: parseDecimalField(o.heightFt), count: o.count }));
    if (parsed.some((o) => o.widthFt.kind !== 'valid' || o.heightFt.kind !== 'valid')) return { state: 'invalid' };
    openingArea = detailedOpeningArea(parsed.map((o) => ({ widthFt: (o.widthFt as { kind: 'valid'; value: Dec }).value, heightFt: (o.heightFt as { kind: 'valid'; value: Dec }).value, count: o.count })));
  }
  const net = netWallArea(gross, openingArea, true);
  if (!net.valid) return { state: 'invalid' };
  return { state: 'ok', area: net.area };
}

interface ResolveOutcome {
  state: 'missing' | 'invalid' | 'ok';
  surface?: ProjectSurface;
}

function resolveSurface(s: Surface, rooms: Map<string, Room>, defaults: { coats: number; wasteRatio: string; loadedHourlyRate: string | null; throughputByKind: Record<string, string | null> }, variantIds: Set<string>): ResolveOutcome {
  if (!s.paintVariantId) return { state: 'missing' };
  if (!variantIds.has(s.paintVariantId)) return { state: 'invalid' };

  const coats = s.coats ?? defaults.coats;
  if (coats < 1) return { state: 'invalid' };
  const wasteRatioField = parseDecimalField(s.wasteRatio ?? defaults.wasteRatio);
  if (wasteRatioField.kind !== 'valid') return { state: wasteRatioField.kind === 'missing' ? 'missing' : 'invalid' };

  const hourlyRateRaw = s.loadedHourlyRate ?? defaults.loadedHourlyRate;
  const hourlyRateField = parseDecimalField(hourlyRateRaw);
  if (hourlyRateField.kind !== 'valid' || !hourlyRateField.value.greaterThan(0)) return { state: hourlyRateField.kind === 'missing' ? 'missing' : 'invalid' };

  let geometry: SurfaceGeometryInput;
  if (s.kind === 'wall' || s.kind === 'ceiling') {
    let area: Dec;
    if (s.measurementMode === 'roomDerived') {
      if (!s.roomId) return { state: 'invalid' };
      const room = rooms.get(s.roomId);
      if (!room) return { state: 'invalid' };
      const derived = roomDerivedGeometry(room, s.kind);
      if (derived.state !== 'ok') return { state: derived.state };
      area = derived.area!;
    } else {
      const areaField = parseDecimalField(s.areaFt2);
      if (areaField.kind !== 'valid' || !areaField.value.greaterThan(0)) return { state: areaField.kind === 'missing' ? 'missing' : 'invalid' };
      area = areaField.value;
    }
    geometry = { kind: s.kind, wallOrCeilingAreaFt2: area };
  } else if (s.kind === 'trim') {
    const lengthField = parseDecimalField(s.trimLengthFt);
    const widthField = parseDecimalField(s.developedWidthFt);
    if (lengthField.kind !== 'valid' || widthField.kind !== 'valid') return { state: lengthField.kind === 'missing' || widthField.kind === 'missing' ? 'missing' : 'invalid' };
    // BOUND-026: a trim length (or width) of exactly 0 is a valid field
    // value (zero-demand geometry), not a field-level error — parseDecimalField
    // already rejects negative input, so no further floor check is needed
    // here. A degenerate all-zero project is caught by the ISSUE gate, not
    // by field validation (CALCULATION_SPEC §1 / DECISIONS.md #8).
    geometry = { kind: 'trim', trimLengthFt: lengthField.value, developedWidthFt: widthField.value };
  } else {
    if (s.doorCount === null || s.doorCount === undefined) return { state: 'missing' };
    if (s.doorCount < 1) return { state: 'invalid' };
    const widthField = parseDecimalField(s.widthFt);
    const heightField = parseDecimalField(s.heightFt);
    if (widthField.kind !== 'valid' || heightField.kind !== 'valid') return { state: widthField.kind === 'missing' || heightField.kind === 'missing' ? 'missing' : 'invalid' };
    if (!widthField.value.greaterThan(0) || !heightField.value.greaterThan(0)) return { state: 'invalid' };
    if (s.paintedSides !== 1 && s.paintedSides !== 2) return { state: 'missing' };
    geometry = { kind: 'door', doorCount: s.doorCount, doorWidthFt: widthField.value, doorHeightFt: heightField.value, paintedSides: s.paintedSides };
  }

  const throughputByKindKey = s.kind === 'door' ? s.hoursPerSidePerCoat : s.throughput;
  const rateRaw = throughputByKindKey ?? defaults.throughputByKind[s.kind];
  const rateField = parseDecimalField(rateRaw);
  if (rateField.kind !== 'valid' || !isPositiveDivisor(rateField.value)) return { state: rateField.kind === 'missing' ? 'missing' : 'invalid' };

  return {
    state: 'ok',
    surface: {
      id: s.id,
      enabled: s.enabled,
      valid: true,
      geometry,
      paintVariantId: s.paintVariantId,
      coats,
      wasteRatio: wasteRatioField.value,
      loadedHourlyRate: hourlyRateField.value,
      rateOrThroughput: rateField.value,
    },
  };
}

export function assembleProjectEstimate(revision: EstimateRevision, opts: { priceMode: 'suggested' | 'custom'; customPriceRaw: string }): ProjectEstimateAssembly {
  const snapshot = revision.activeRateSnapshot;
  const settings = snapshot.businessSettings;
  const rooms = new Map(revision.rooms.map((r) => [r.id, r]));
  const variantIds = new Set(snapshot.paintVariants.map((v) => v.id));

  const enabledSurfaces = revision.surfaces.filter((s) => s.enabled);
  if (enabledSurfaces.length === 0) return incompleteResult(['At least one enabled surface is required.']);

  const defaults = {
    coats: settings.defaultCoats,
    wasteRatio: settings.defaultWasteRatio,
    loadedHourlyRate: settings.loadedHourlyRate,
    throughputByKind: { wall: settings.wallThroughput, ceiling: settings.ceilingThroughput, trim: settings.trimThroughput, door: settings.doorHoursPerSidePerCoat } as Record<string, string | null>,
  };

  const resolvedEnabled: ProjectSurface[] = [];
  for (const s of enabledSurfaces) {
    const outcome = resolveSurface(s, rooms, defaults, variantIds);
    if (outcome.state === 'missing') return incompleteResult([`Surface "${s.id}" is missing required inputs.`]);
    if (outcome.state === 'invalid') return invalidResult([`Surface "${s.id}" has invalid inputs.`]);
    resolvedEnabled.push(outcome.surface!);
  }

  const variantPricing = new Map<string, VariantPricing>(snapshot.paintVariants.map((v) => [v.id, { coveragePerGal: new PEP(v.coverageFt2PerGal), pricePerGal: new PEP(v.pricePerGal) }]));
  const { valid, result } = aggregateProjectSurfaces(resolvedEnabled, variantPricing);
  if (!valid || !result) return invalidResult(['Surface aggregation failed unexpectedly.']);

  // A blank/malformed line here is a genuine, reachable UI state — a newly
  // added other-material/additional-labor/expense line starts empty before
  // the customer finishes typing every field, and `new PEP('')`/`new
  // PEP('abc')` THROWS rather than returning a structured result. Every
  // raw string from these project-costing lines is validated the same way
  // every other user-entered field in this assembly already is: missing
  // blocks as incomplete, malformed blocks as invalid, before it ever
  // reaches a Decimal constructor.
  const otherMaterialQuantities: Dec[] = [];
  const otherMaterialUnitCosts: Dec[] = [];
  for (const l of revision.otherMaterialLines) {
    const q = parseDecimalField(l.quantity);
    const uc = parseDecimalField(l.unitCost);
    if (q.kind === 'missing' || uc.kind === 'missing') return incompleteResult([`Other material "${l.description || l.id}" is missing a quantity or unit cost.`]);
    if (q.kind === 'invalid' || uc.kind === 'invalid') return invalidResult([`Other material "${l.description || l.id}" has an invalid quantity or unit cost.`]);
    otherMaterialQuantities.push(q.value);
    otherMaterialUnitCosts.push(uc.value);
  }
  const otherMaterials = otherMaterialCost(otherMaterialQuantities.map((quantity, i) => ({ quantity, unitCost: otherMaterialUnitCosts[i] })));

  const allowanceAmountField = parseDecimalField(revision.suppliesAllowance.amount);
  const allowanceRatioField = parseDecimalField(revision.suppliesAllowance.ratio);
  if (allowanceAmountField.kind === 'missing' || allowanceRatioField.kind === 'missing') return incompleteResult(['Supplies allowance amount/ratio is missing.']);
  if (allowanceAmountField.kind === 'invalid' || allowanceRatioField.kind === 'invalid') return invalidResult(['Supplies allowance amount/ratio is invalid.']);
  const allowance = suppliesAllowance(
    { mode: revision.suppliesAllowance.mode, flatAmount: allowanceAmountField.value, paintPercentRatio: allowanceRatioField.value },
    result.materialsCost
  );
  const materials = materialsTotal(result.materialsCost, otherMaterials, allowance);

  let additionalLaborCost = new PEP(0);
  for (const l of revision.additionalLabor) {
    const hoursField = parseDecimalField(l.hours);
    const rateField = parseDecimalField(l.loadedHourlyRate);
    if (hoursField.kind === 'missing' || rateField.kind === 'missing') return incompleteResult([`Additional labor "${l.description || l.id}" is missing hours or a loaded rate.`]);
    if (hoursField.kind === 'invalid' || rateField.kind === 'invalid') return invalidResult([`Additional labor "${l.description || l.id}" has invalid hours or rate.`]);
    additionalLaborCost = additionalLaborCost.plus(hoursField.value.times(rateField.value));
  }
  const laborCost = result.laborCost.plus(additionalLaborCost);

  const otherExpenseAmounts: Dec[] = [];
  for (const l of revision.otherExpenses) {
    const amountField = parseDecimalField(l.amount);
    if (amountField.kind === 'missing') return incompleteResult([`Expense "${l.description || l.id}" is missing an amount.`]);
    if (amountField.kind === 'invalid') return invalidResult([`Expense "${l.description || l.id}" has an invalid amount.`]);
    otherExpenseAmounts.push(amountField.value);
  }
  const otherExpenses = otherExpensesTotal(otherExpenseAmounts.map((amount) => ({ amount })));
  const dc = directCost(materials, laborCost, otherExpenses);
  const overheadRatioField = parseDecimalField(settings.overheadRatio);
  if (overheadRatioField.kind !== 'valid') return invalidResult(['Overhead ratio is invalid.']);
  const oh = overheadAmount(dc, overheadRatioField.value);
  const jobCost = estimatedJobCost(dc, oh);

  const targetField = parseDecimalField(settings.targetMarginRatio);
  if (targetField.kind !== 'valid') return invalidResult(['Target margin is invalid.']);
  // V5-01 (related path): CALCULATION_SPEC.md §1 requires 0 <= targetMarginRatio
  // < 1. requiredPriceRaw() throws outside that range instead of returning a
  // structured result -- guard it here too, matching the free job-cost
  // calculator's existing check, so a saved 100%/negative target settings
  // value can't crash the Pro estimate summary the same way it crashed
  // Price Book Health.
  if (targetField.value.greaterThanOrEqualTo(1) || targetField.value.isNegative()) {
    return invalidResult(['Target margin must be a percentage from 0% up to (but not including) 100%.']);
  }

  // V5-07/CORE-021: CALCULATION_SPEC.md §6: "User-entered proposedPrice uses
  // at most two decimal places; reject extra decimals until corrected."
  // Without maxFractionDigits:2, a raw-entered "12.005" parsed as a valid
  // ten-fraction-digit decimal and was accepted as a complete, issueable
  // price -- display rounding could then round it to a DIFFERENT cent
  // value than the one actually stored as the quote.
  const customPriceField = opts.priceMode === 'custom' ? parseDecimalField(opts.customPriceRaw, { allowNegative: false, maxFractionDigits: 2 }) : { kind: 'missing' as const };
  if (opts.priceMode === 'custom' && customPriceField.kind === 'invalid') return invalidResult(['Custom price is invalid.']);
  const priceInput = opts.priceMode === 'custom' && customPriceField.kind === 'valid' ? customPriceField.value : null;

  const priced = evaluatePrice({ cost: jobCost, price: priceInput, targetMarginRatio: targetField.value });
  const effectivePrice = opts.priceMode === 'suggested' ? priced.minimumTargetPrice : priceInput;
  // Regression (found live in the browser): suggested mode used to report
  // `priced` — the evaluation at priceInput=null ("unpriced", profit=null)
  // — even though a real effectivePrice (the suggested price) existed.
  // Always re-evaluate AT the effective price when one exists, for either mode.
  const finalPrice = effectivePrice !== null ? evaluatePrice({ cost: jobCost, price: effectivePrice, targetMarginRatio: targetField.value }) : priced;

  return {
    calculationState: 'complete',
    reasons: [],
    aggregate: result,
    materials,
    laborCost,
    directCost: dc,
    overhead: oh,
    jobCost,
    price: finalPrice,
    suggestedPrice: priced.minimumTargetPrice,
    effectivePrice,
  };
}
