import { PEP, type Dec } from '../engine/decimal';
import {
  parseDecimalField,
  isPositiveDivisor,
  isValidOpeningCount,
  MAX_RATIO,
  MAX_ROOM_DIMENSION_FT,
  MAX_AREA_FT2,
  MAX_TRIM_LENGTH_FT,
  MAX_HOURS,
  MAX_RATE,
  MAX_MONETARY_INPUT,
  MAX_ROOMS_PER_PROJECT,
  MAX_SURFACES_PER_PROJECT,
  MAX_DOCUMENT_LINES_PER_PROJECT,
} from '../engine/parse';
import { grossWallArea, ceilingArea, netWallArea, quickOpeningArea, detailedOpeningArea } from '../engine/geometry';
import { aggregateProjectSurfaces, type ProjectSurface, type ProjectAggregateResult, type VariantPricing, type SurfaceGeometryInput } from '../engine/estimate';
import { materialsTotal, otherMaterialCost, otherExpensesTotal, directCost, overheadAmount, estimatedJobCost, suppliesAllowance } from '../engine/cost';
import { evaluatePrice } from '../engine/pricing';
import { isDraftEngineVersionSupported, RECOGNIZED_ENGINE_VERSIONS } from './engineCompatibility';
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
  /** CALCULATION_SPEC.md §1: "Waste >0.5 and overhead >0.5 produce
   * nonblocking review warnings." Only ever populated alongside a
   * 'complete' result -- an incomplete/invalid result has no computed
   * values yet for a warning to be meaningfully about. */
  warnings: string[];
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
  return { calculationState: 'incomplete', reasons, warnings: [], aggregate: null, materials: null, laborCost: null, directCost: null, overhead: null, jobCost: null, price: null, suggestedPrice: null, effectivePrice: null };
}

function invalidResult(reasons: string[]): ProjectEstimateAssembly {
  return { calculationState: 'invalid', reasons, warnings: [], aggregate: null, materials: null, laborCost: null, directCost: null, overhead: null, jobCost: null, price: null, suggestedPrice: null, effectivePrice: null };
}

/** Room-derived geometry for a wall or ceiling surface whose measurementMode
 * is 'roomDerived'. Returns null (incomplete) if the room's own dimensions
 * are not yet filled in, or `valid:false` if openings exceed gross area. */
function roomDerivedGeometry(room: Room, kind: 'wall' | 'ceiling'): { state: 'missing' | 'invalid' | 'ok'; area?: Dec } {
  // BOUND-018..021: a room dimension is a "geometry" field (spec: >0,
  // <=100,000 ft) -- the upper bound used to be entirely unchecked here.
  const dimOpts = { max: MAX_ROOM_DIMENSION_FT };
  const length = parseDecimalField(room.lengthFt, dimOpts);
  const width = parseDecimalField(room.widthFt, dimOpts);
  const height = parseDecimalField(room.heightFt, dimOpts);
  if (length.kind === 'missing' || width.kind === 'missing' || height.kind === 'missing') return { state: 'missing' };
  if (length.kind === 'invalid' || width.kind === 'invalid' || height.kind === 'invalid') return { state: 'invalid' };
  if (!length.value.greaterThan(0) || !width.value.greaterThan(0) || !height.value.greaterThan(0)) return { state: 'invalid' };

  if (kind === 'ceiling') return { state: 'ok', area: ceilingArea(length.value, width.value) };

  const gross = grossWallArea(length.value, width.value, height.value);
  if (!room.deductionEnabled) return { state: 'ok', area: gross };

  let openingArea: Dec;
  if (room.openingMode === 'quick') {
    // V6-04: doorCount/windowCount were passed directly into the area
    // formula with no range check at all -- a negative count (reachable
    // via a direct object mutation, or any future code path that isn't
    // the interactive UI) SUBTRACTED area from the deduction, inflating
    // net wall area and the resulting price instead of being rejected.
    // Only the import validator (checkRequiredInt) enforced this; the
    // calculation engine did not independently guard itself.
    if (!isValidOpeningCount(room.quick.doorCount) || !isValidOpeningCount(room.quick.windowCount)) return { state: 'invalid' };
    const doorArea = parseDecimalField(room.quick.doorAreaEach);
    const windowArea = parseDecimalField(room.quick.windowAreaEach);
    if (doorArea.kind !== 'valid' || windowArea.kind !== 'valid') return { state: 'invalid' };
    openingArea = quickOpeningArea(room.quick.doorCount, doorArea.value, room.quick.windowCount, windowArea.value);
  } else {
    if (room.openings.some((o) => !isValidOpeningCount(o.count))) return { state: 'invalid' };
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
  // BOUND-012..017: overheadRatio/wasteRatio share CALCULATION_SPEC's [0,1]
  // bound; the upper half (>1 rejected) used to be entirely unchecked.
  const wasteRatioField = parseDecimalField(s.wasteRatio ?? defaults.wasteRatio, { max: MAX_RATIO });
  if (wasteRatioField.kind !== 'valid') return { state: wasteRatioField.kind === 'missing' ? 'missing' : 'invalid' };

  // BOUND-043..046: a rate/throughput field is a positive divisor
  // (isPositiveDivisor, unchanged) AND now also capped at the spec's
  // "rates <=1,000,000 per unit" ceiling.
  const hourlyRateRaw = s.loadedHourlyRate ?? defaults.loadedHourlyRate;
  const hourlyRateField = parseDecimalField(hourlyRateRaw, { max: MAX_RATE });
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
      // BOUND-022..025: manualAreaFt2 is >0, <=1,000,000,000 ft².
      const areaField = parseDecimalField(s.areaFt2, { max: MAX_AREA_FT2 });
      if (areaField.kind !== 'valid' || !areaField.value.greaterThan(0)) return { state: areaField.kind === 'missing' ? 'missing' : 'invalid' };
      area = areaField.value;
    }
    geometry = { kind: s.kind, wallOrCeilingAreaFt2: area };
  } else if (s.kind === 'trim') {
    // BOUND-026..029: trimLengthFt is [0,1,000,000] ft (0 IS a valid
    // field value -- see the comment below -- only the ceiling was absent).
    const lengthField = parseDecimalField(s.trimLengthFt, { max: MAX_TRIM_LENGTH_FT });
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
  const rateField = parseDecimalField(rateRaw, { max: MAX_RATE });
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

  // BACK-026: live recalculation runs TODAY's formulas against a stored
  // snapshot -- only safe when this build actually recognizes that
  // snapshot's own engineVersion. An unrecognized version (most
  // realistically: captured by a newer build, now opened in an older
  // one) is never silently recalculated as though it were current; this
  // check does NOT apply to frozen/issued data (readFrozenCalculatedOutputs
  // never calls it), which is always read-only regardless of version.
  if (!isDraftEngineVersionSupported(revision)) {
    return invalidResult([
      `This draft was created with app engine version ${snapshot.engineVersion}, which this app version does not recognize (supported: ${RECOGNIZED_ENGINE_VERSIONS.join(', ')}). Recalculating it here could silently apply different formulas than the ones it was created with. Open this draft in the app version that created it, or contact support before continuing.`,
    ]);
  }

  // BOUND-047..061: project-level structural caps (CALCULATION_SPEC.md §1
  // "at most 500 rooms, 2,000 surfaces, 2,000 document lines per project").
  // documentLineCount is interpreted as additionalLabor + otherMaterialLines
  // + otherExpenses combined -- see MAX_DOCUMENT_LINES_PER_PROJECT's own
  // comment in engine/parse.ts for why.
  if (revision.rooms.length > MAX_ROOMS_PER_PROJECT) return invalidResult([`A project may have at most ${MAX_ROOMS_PER_PROJECT} rooms.`]);
  if (revision.surfaces.length > MAX_SURFACES_PER_PROJECT) return invalidResult([`A project may have at most ${MAX_SURFACES_PER_PROJECT} surfaces.`]);
  const documentLineCount = revision.additionalLabor.length + revision.otherMaterialLines.length + revision.otherExpenses.length;
  if (documentLineCount > MAX_DOCUMENT_LINES_PER_PROJECT) return invalidResult([`A project may have at most ${MAX_DOCUMENT_LINES_PER_PROJECT} additional cost lines.`]);

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

  // CALCULATION_SPEC.md §1: "Waste >0.5 ... produce nonblocking review
  // warnings" -- checked per resolved surface (each may have its own
  // override or fall back to the settings default), strictly greater than
  // 0.5 so the boundary value itself never warns.
  const warnings: string[] = [];
  for (const s of resolvedEnabled) {
    if (s.wasteRatio.greaterThan('0.5')) {
      warnings.push(`Surface "${s.id}" has an unusually high waste ratio (${s.wasteRatio.times(100).toString()}%). Double-check this is intentional.`);
    }
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
    const uc = parseDecimalField(l.unitCost, { max: MAX_MONETARY_INPUT }); // BOUND-039..042

    if (q.kind === 'missing' || uc.kind === 'missing') return incompleteResult([`Other material "${l.description || l.id}" is missing a quantity or unit cost.`]);
    if (q.kind === 'invalid' || uc.kind === 'invalid') return invalidResult([`Other material "${l.description || l.id}" has an invalid quantity or unit cost.`]);
    otherMaterialQuantities.push(q.value);
    otherMaterialUnitCosts.push(uc.value);
  }
  const otherMaterials = otherMaterialCost(otherMaterialQuantities.map((quantity, i) => ({ quantity, unitCost: otherMaterialUnitCosts[i] })));

  // V6-06: this used to parse and REQUIRE both the flat amount and the
  // percent ratio regardless of which mode was active, so a stale/blank
  // value left behind in the INACTIVE field (e.g. switching Flat -> None
  // without ever touching the ratio) blocked the whole estimate even
  // though suppliesAllowance() below never reads that field for the
  // active mode. Only validate/use the one field the active mode reads.
  let allowanceFlatAmount: Dec | undefined;
  let allowancePaintPercentRatio: Dec | undefined;
  if (revision.suppliesAllowance.mode === 'flat') {
    const amountField = parseDecimalField(revision.suppliesAllowance.amount, { max: MAX_MONETARY_INPUT }); // BOUND-039..042
    if (amountField.kind === 'missing') return incompleteResult(['Supplies allowance amount is missing.']);
    if (amountField.kind === 'invalid') return invalidResult(['Supplies allowance amount is invalid.']);
    allowanceFlatAmount = amountField.value;
  } else if (revision.suppliesAllowance.mode === 'paintPercent') {
    const ratioField = parseDecimalField(revision.suppliesAllowance.ratio);
    if (ratioField.kind === 'missing') return incompleteResult(['Supplies allowance percentage is missing.']);
    if (ratioField.kind === 'invalid') return invalidResult(['Supplies allowance percentage is invalid.']);
    allowancePaintPercentRatio = ratioField.value;
  }
  const allowance = suppliesAllowance(
    { mode: revision.suppliesAllowance.mode, flatAmount: allowanceFlatAmount, paintPercentRatio: allowancePaintPercentRatio },
    result.materialsCost
  );
  const materials = materialsTotal(result.materialsCost, otherMaterials, allowance);

  let additionalLaborCost = new PEP(0);
  for (const l of revision.additionalLabor) {
    const hoursField = parseDecimalField(l.hours, { max: MAX_HOURS }); // BOUND-035..038
    const rateField = parseDecimalField(l.loadedHourlyRate, { max: MAX_RATE });
    if (hoursField.kind === 'missing' || rateField.kind === 'missing') return incompleteResult([`Additional labor "${l.description || l.id}" is missing hours or a loaded rate.`]);
    if (hoursField.kind === 'invalid' || rateField.kind === 'invalid') return invalidResult([`Additional labor "${l.description || l.id}" has invalid hours or rate.`]);
    additionalLaborCost = additionalLaborCost.plus(hoursField.value.times(rateField.value));
  }
  const laborCost = result.laborCost.plus(additionalLaborCost);

  const otherExpenseAmounts: Dec[] = [];
  for (const l of revision.otherExpenses) {
    const amountField = parseDecimalField(l.amount, { max: MAX_MONETARY_INPUT }); // BOUND-039..042
    if (amountField.kind === 'missing') return incompleteResult([`Expense "${l.description || l.id}" is missing an amount.`]);
    if (amountField.kind === 'invalid') return invalidResult([`Expense "${l.description || l.id}" has an invalid amount.`]);
    otherExpenseAmounts.push(amountField.value);
  }
  const otherExpenses = otherExpensesTotal(otherExpenseAmounts.map((amount) => ({ amount })));
  const dc = directCost(materials, laborCost, otherExpenses);
  const overheadRatioField = parseDecimalField(settings.overheadRatio, { max: MAX_RATIO }); // BOUND-012..013
  if (overheadRatioField.kind !== 'valid') return invalidResult(['Overhead ratio is invalid.']);
  // CALCULATION_SPEC.md §1: "overhead >0.5 produce[s] nonblocking review
  // warnings" -- a high ratio is still a VALID, complete calculation
  // (never rejected), only flagged for the user to double-check.
  if (overheadRatioField.value.greaterThan('0.5')) {
    warnings.push(`Overhead is set unusually high (${overheadRatioField.value.times(100).toString()}% of direct cost). Double-check this is intentional.`);
  }
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
    warnings,
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
