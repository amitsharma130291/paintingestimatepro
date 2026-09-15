// Turns a persisted ServiceDefinition + the live paint catalog + business
// settings into a real Price Book Health row — independent-review R08:
// the shipped UI computed exactly one hardcoded "wall-standard" service
// from catalog[0] with a null selling price, never reading any actually
// saved ServiceDefinition record at all. This is the pure per-kind
// mapping (wall/ceiling/trim/door each have a different "per one unit"
// area and application-hours basis — CALCULATION_SPEC.md §8) that the
// hardcoded version skipped entirely.
import { PEP, type Dec } from '../engine/decimal';
import { parseDecimalField, parseCountField, isPositiveDivisor } from '../engine/parse';
import { wallOrCeilingHours, trimHours, doorHours } from '../engine/labor';
import { computeServiceUnitCost, evaluateServiceHealth, type ServiceHealthRow } from '../engine/serviceHealth';
import type { ServiceDefinition, PaintVariant, BusinessSettings } from './entities';

export type ServiceHealthAssemblyResult = { state: 'ok'; row: ServiceHealthRow } | { state: 'incomplete' | 'invalid'; reasons: string[] };

export function assembleServiceHealth(service: ServiceDefinition, catalog: PaintVariant[], settings: BusinessSettings): ServiceHealthAssemblyResult {
  const variant = service.paintVariantId ? catalog.find((v) => v.id === service.paintVariantId) : undefined;
  if (!variant) {
    return { state: 'incomplete', reasons: ['Select a paint variant — none chosen, or the previously-chosen one no longer exists in the catalog.'] };
  }
  const pricePerGalField = parseDecimalField(variant.pricePerGal);
  const coverageField = parseDecimalField(variant.coverageFt2PerGal);
  if (pricePerGalField.kind !== 'valid' || coverageField.kind !== 'valid' || !isPositiveDivisor(coverageField.value)) {
    return { state: 'invalid', reasons: [`Paint variant "${variant.name}" has an invalid price or coverage.`] };
  }

  const coatsField = parseCountField(String(service.coats ?? settings.defaultCoats), { min: 1, max: 5 });
  if (coatsField.kind !== 'valid') return { state: 'invalid', reasons: ['Coats must be a whole number from 1 to 5.'] };
  const coats = coatsField.value;

  const wasteRatioField = parseDecimalField(service.wasteRatio ?? settings.defaultWasteRatio);
  if (wasteRatioField.kind !== 'valid') return { state: 'invalid', reasons: ['Waste ratio must be a valid non-negative number.'] };

  const loadedRateRaw = service.loadedHourlyRate ?? settings.loadedHourlyRate;
  if (!loadedRateRaw) return { state: 'incomplete', reasons: ['A loaded hourly rate is required (set one on this service, or a global default in Business settings).'] };
  const loadedRateField = parseDecimalField(loadedRateRaw);
  if (loadedRateField.kind !== 'valid' || !loadedRateField.value.greaterThan(0)) return { state: 'invalid', reasons: ['Loaded hourly rate must be a positive number.'] };

  let areaPerUnit: Dec;
  let applicationHoursPerUnit: Dec;

  if (service.kind === 'wall' || service.kind === 'ceiling') {
    areaPerUnit = new PEP(1);
    const throughputRaw = service.throughput ?? (service.kind === 'wall' ? settings.wallThroughput : settings.ceilingThroughput);
    if (!throughputRaw) return { state: 'incomplete', reasons: ['A production rate (sqft/hr/coat) is required.'] };
    const throughputField = parseDecimalField(throughputRaw);
    if (throughputField.kind !== 'valid' || !isPositiveDivisor(throughputField.value)) return { state: 'invalid', reasons: ['Production rate must be a positive number.'] };
    applicationHoursPerUnit = wallOrCeilingHours(areaPerUnit, coats, throughputField.value);
  } else if (service.kind === 'trim') {
    const widthField = parseDecimalField(service.developedWidthFt);
    if (widthField.kind === 'missing') return { state: 'incomplete', reasons: ['Developed width (ft) is required for a trim service.'] };
    if (widthField.kind !== 'valid' || !widthField.value.greaterThan(0)) return { state: 'invalid', reasons: ['Developed width must be a positive number.'] };
    areaPerUnit = widthField.value; // per 1 linear ft
    const throughputRaw = service.throughput ?? settings.trimThroughput;
    if (!throughputRaw) return { state: 'incomplete', reasons: ['A production rate (linear ft/hr/coat) is required.'] };
    const throughputField = parseDecimalField(throughputRaw);
    if (throughputField.kind !== 'valid' || !isPositiveDivisor(throughputField.value)) return { state: 'invalid', reasons: ['Production rate must be a positive number.'] };
    applicationHoursPerUnit = trimHours(new PEP(1), coats, throughputField.value);
  } else {
    const widthField = parseDecimalField(service.widthFt);
    const heightField = parseDecimalField(service.heightFt);
    if (widthField.kind === 'missing' || heightField.kind === 'missing') return { state: 'incomplete', reasons: ['Door width and height are required.'] };
    if (widthField.kind !== 'valid' || heightField.kind !== 'valid' || !widthField.value.greaterThan(0) || !heightField.value.greaterThan(0)) {
      return { state: 'invalid', reasons: ['Door width and height must be positive numbers.'] };
    }
    if (service.paintedSides !== 1 && service.paintedSides !== 2) return { state: 'incomplete', reasons: ['Painted sides (1 or 2) is required for a door service.'] };
    areaPerUnit = widthField.value.times(heightField.value).times(service.paintedSides);
    const hoursRaw = service.hoursPerSidePerCoat ?? settings.doorHoursPerSidePerCoat;
    if (!hoursRaw) return { state: 'incomplete', reasons: ['Hours per side per coat is required.'] };
    const hoursField = parseDecimalField(hoursRaw);
    if (hoursField.kind !== 'valid' || !hoursField.value.greaterThan(0)) return { state: 'invalid', reasons: ['Hours per side per coat must be a positive number.'] };
    applicationHoursPerUnit = doorHours(1, service.paintedSides, coats, hoursField.value);
  }

  const additionalLaborField = parseDecimalField(service.additionalLaborHoursPerUnit);
  const suppliesField = parseDecimalField(service.suppliesCostPerUnit);
  const directExpenseField = parseDecimalField(service.directExpensePerUnit);
  if (additionalLaborField.kind !== 'valid' || suppliesField.kind !== 'valid' || directExpenseField.kind !== 'valid') {
    return { state: 'invalid', reasons: ['Additional labor hours, supplies cost, and direct expense per unit must all be valid non-negative numbers.'] };
  }

  const overheadRatioField = parseDecimalField(settings.overheadRatio);
  const targetMarginField = parseDecimalField(settings.targetMarginRatio);
  if (overheadRatioField.kind !== 'valid' || targetMarginField.kind !== 'valid') {
    return { state: 'invalid', reasons: ['Business overhead ratio / target margin settings are invalid.'] };
  }

  const unitCost = computeServiceUnitCost({
    kind: service.kind,
    areaPerUnit,
    coats,
    wasteRatio: wasteRatioField.value,
    coverageFt2PerGal: coverageField.value,
    pricePerGal: pricePerGalField.value,
    applicationHoursPerUnit,
    additionalLaborHoursPerUnit: additionalLaborField.value,
    loadedHourlyRate: loadedRateField.value,
    suppliesCostPerUnit: suppliesField.value,
    directExpensePerUnit: directExpenseField.value,
    overheadRatio: overheadRatioField.value,
  });

  // A missing selling price is a valid, common state ("what would this
  // service need to sell for") — NOT the same as an invalid one.
  const sellingPriceField = service.currentSellingPrice !== null ? parseDecimalField(service.currentSellingPrice) : { kind: 'missing' as const };
  if (sellingPriceField.kind === 'invalid') return { state: 'invalid', reasons: [`Current selling price: ${sellingPriceField.message}`] };
  const sellingPrice = sellingPriceField.kind === 'valid' ? sellingPriceField.value : null;

  const row = evaluateServiceHealth(service.id, unitCost, sellingPrice, targetMarginField.value);
  return { state: 'ok', row };
}
