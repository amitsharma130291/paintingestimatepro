// CAT-008 (DATA_CONTRACT.md: "Labor and overhead defaults are copied to
// editable service assumptions; expose an explicit refresh-defaults
// action" -- tool-specs/04: "Changing default labor/production settings
// does not invisibly rewrite customized service assumptions: provide
// 'refresh service defaults' with a change preview.").
//
// Unlike a Pro estimate's RateSnapshot (a frozen copy that goes stale and
// needs an explicit applyRateRefresh/undoRateRefresh cycle), a
// ServiceDefinition has no snapshot at all -- assembleServiceHealth
// always resolves an unset (null) override against the CURRENT live
// BusinessSettings on every read. That is exactly why "changing a
// default never rewrites a customized assumption" already holds: a
// customized (non-null) field is simply never touched by a settings
// change. What's missing is the other half -- a way to SEE that a
// customization has drifted from the current default and choose,
// per field, to drop back to live-default tracking.
//
// "Refresh" here therefore never copies the new default's literal value
// into the field (that would just create a new, different frozen value,
// no better than the stale one) -- it clears the override to `null` so
// the field starts tracking the live default again, exactly like a
// service that never customized it in the first place.
import type { ServiceDefinition, PaintVariant, BusinessSettings } from './entities';

export type ServiceRefreshableField = 'coats' | 'wasteRatio' | 'loadedHourlyRate' | 'throughput' | 'hoursPerSidePerCoat';

export const SERVICE_REFRESHABLE_FIELD_LABELS: Record<ServiceRefreshableField, string> = {
  coats: 'Coats',
  wasteRatio: 'Waste ratio',
  loadedHourlyRate: 'Loaded hourly rate',
  throughput: 'Production rate',
  hoursPerSidePerCoat: 'Hours per side per coat',
};

export interface ServiceFieldChange {
  field: ServiceRefreshableField;
  label: string;
  /** The service's own current override (never null -- only fields the
   * service has actually customized are reported). */
  customValue: string | number;
  /** What this field currently resolves to under live business settings. */
  liveDefaultValue: string | number | null;
}

export interface ServiceRefreshDiff {
  fieldChanges: ServiceFieldChange[];
  /** True when the service's chosen paint variant no longer exists in
   * the catalog. Only a REPLACEMENT decision applies here (pick a
   * different live variant, via the same selector the row's own editor
   * already offers) -- "retain the old variant's values," meaningful for
   * a Pro estimate's frozen snapshot, has no equivalent for a service
   * definition, which never snapshots historical catalog data. */
  variantMissing: boolean;
}

/** Geometry fields (developedWidthFt, widthFt, heightFt, paintedSides)
 * are deliberately excluded: CALCULATION_SPEC requires no hidden default
 * for customer-entered geometry (V5-10), so there is nothing to "refresh"
 * them against. currentSellingPrice/additionalLaborHoursPerUnit/
 * suppliesCostPerUnit/directExpensePerUnit are excluded for the same
 * reason -- no business-level default exists for any of them. */
export function previewServiceDefaultsRefresh(service: ServiceDefinition, catalog: PaintVariant[], settings: BusinessSettings): ServiceRefreshDiff {
  const fieldChanges: ServiceFieldChange[] = [];

  function check(field: ServiceRefreshableField, customValue: string | number | null, liveDefaultValue: string | number | null) {
    if (customValue === null) return; // never customized -- already tracking live, nothing to refresh
    fieldChanges.push({ field, label: SERVICE_REFRESHABLE_FIELD_LABELS[field], customValue, liveDefaultValue });
  }

  check('coats', service.coats, settings.defaultCoats);
  check('wasteRatio', service.wasteRatio, settings.defaultWasteRatio);
  check('loadedHourlyRate', service.loadedHourlyRate, settings.loadedHourlyRate);
  if (service.kind === 'wall') check('throughput', service.throughput, settings.wallThroughput);
  else if (service.kind === 'ceiling') check('throughput', service.throughput, settings.ceilingThroughput);
  else if (service.kind === 'trim') check('throughput', service.throughput, settings.trimThroughput);
  else check('hoursPerSidePerCoat', service.hoursPerSidePerCoat, settings.doorHoursPerSidePerCoat);

  // GEO-014's own lesson generalized: match the variant by id only, NEVER
  // by display name -- a deleted-then-recreated variant with the same
  // name is a DIFFERENT record (different price/coverage), not the same one.
  const variantMissing = service.paintVariantId !== null && !catalog.some((v) => v.id === service.paintVariantId);

  return { fieldChanges, variantMissing };
}

/** Applies the user's per-field choice: a field named in `fieldsToRevert`
 * is cleared to null (resume live-default tracking); every other field,
 * INCLUDING currentSellingPrice and every other field this function never
 * even looks at, is copied through completely unchanged. */
export function applyServiceDefaultsRefresh(service: ServiceDefinition, fieldsToRevert: ReadonlySet<ServiceRefreshableField>): ServiceDefinition {
  const updated: ServiceDefinition = { ...service };
  for (const field of fieldsToRevert) {
    updated[field] = null;
  }
  return updated;
}
