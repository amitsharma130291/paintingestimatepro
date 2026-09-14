import type { BackupEnvelope, Project, BusinessSettings, PaintVariant, OtherMaterial, ServiceDefinition, ImportProvenanceRecord } from './entities';
import { SCHEMA_VERSION, ENGINE_VERSION } from './entities';
import type { IdSource } from './ids';
import { parseDecimalField, isPositiveDivisor } from '../engine/parse';

const REVISION_STATES = new Set(['draft', 'issued', 'superseded']);
const PRICE_MODES = new Set(['suggested', 'custom']);
const SUPPLIES_MODES = new Set(['none', 'flat', 'paintPercent']);
const SERVICE_UNITS = new Set(['ft2', 'linearFt', 'door']);
const SERVICE_KINDS = new Set(['wall', 'ceiling', 'trim', 'door']);
const OPENING_MODES = new Set(['quick', 'detailed']);
const OPENING_TYPES = new Set(['door', 'window']);
const MEASUREMENT_MODES = new Set(['roomDerived', 'manual']);
const CALCULATION_STATES = new Set(['complete', 'incomplete', 'invalid']);
const ACTUAL_REVIEW_STATES = new Set(['inProgress', 'final']);
const OVERHEAD_MODES = new Set(['baselineAllocation', 'actualFlat']);
const LABOR_BREAKDOWN_MODES = new Set(['direct', 'hoursRate']);

/** True for a non-null, non-array object — the guard every nested-entity
 * validator runs before touching a single field, so a corrupted `null` or
 * primitive sitting where an object belongs is reported as a structured
 * issue instead of throwing (item 5: "avoid uncaught exceptions"). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkRequiredString(path: string, v: unknown, issues: ValidationIssue[]): void {
  if (typeof v !== 'string') issues.push({ path, message: `Expected a string at ${path}, got ${v === null ? 'null' : typeof v}.` });
}

function checkOptionalString(path: string, v: unknown, issues: ValidationIssue[]): void {
  if (v === null || v === undefined) return;
  checkRequiredString(path, v, issues);
}

function checkRequiredBoolean(path: string, v: unknown, issues: ValidationIssue[]): void {
  if (typeof v !== 'boolean') issues.push({ path, message: `Expected a boolean at ${path}, got ${v === null ? 'null' : typeof v}.` });
}

function checkEnum(path: string, v: unknown, allowed: Set<string>, issues: ValidationIssue[]): void {
  if (typeof v !== 'string' || !allowed.has(v)) issues.push({ path, message: `Unknown value "${String(v)}" at ${path}; expected one of: ${[...allowed].join('|')}.` });
}

/** A required, non-negative decimal scalar (catalog prices, coverage, etc.).
 * BACK-020: reject non-decimal scalars and negative costs, never coerce. */
function checkRequiredNonNegativeDecimal(path: string, raw: unknown, issues: ValidationIssue[]): void {
  if (typeof raw !== 'string') {
    issues.push({ path, message: `Expected a decimal string at ${path}, got ${raw === null ? 'null' : typeof raw}.` });
    return;
  }
  const parsed = parseDecimalField(raw);
  if (parsed.kind === 'missing') issues.push({ path, message: `Missing required decimal value at ${path}.` });
  else if (parsed.kind === 'invalid') issues.push({ path, message: `Invalid decimal value at ${path}: ${parsed.message}` });
}

/** An optional (nullable) decimal scalar that, when present, must be a
 * non-negative decimal string — e.g. a revision's proposedPrice, which is
 * legitimately `null` for an unpriced estimate. */
function checkOptionalNonNegativeDecimal(path: string, raw: unknown, issues: ValidationIssue[]): void {
  if (raw === null || raw === undefined) return;
  checkRequiredNonNegativeDecimal(path, raw, issues);
}

/** A required decimal that must ALSO be safely usable as a divisor
 * (coverage, throughput) — CALCULATION_SPEC's engineering bound rejects a
 * near-zero positive divisor outright rather than letting a quotient blow
 * up silently. Zero itself is the most common real-world corruption case
 * (item 5's "zero coverage" regression) and is caught by the same check. */
function checkRequiredPositiveDivisorDecimal(path: string, raw: unknown, issues: ValidationIssue[]): void {
  checkRequiredNonNegativeDecimal(path, raw, issues);
  if (typeof raw !== 'string') return;
  const parsed = parseDecimalField(raw);
  if (parsed.kind === 'valid' && !isPositiveDivisor(parsed.value)) {
    issues.push({ path, message: `${path} must be a positive value large enough to safely divide by; got "${raw}".` });
  }
}

/** Same as above, but the field is nullable (nullable-until-configured
 * business settings, or a per-surface override that falls back to a
 * global default when absent). */
function checkOptionalPositiveDivisorDecimal(path: string, raw: unknown, issues: ValidationIssue[]): void {
  if (raw === null || raw === undefined) return;
  checkRequiredPositiveDivisorDecimal(path, raw, issues);
}

function checkRequiredInt(path: string, v: unknown, issues: ValidationIssue[], opts: { min?: number; max?: number } = {}): void {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    issues.push({ path, message: `Expected an integer at ${path}, got ${v === null ? 'null' : typeof v}.` });
    return;
  }
  if (opts.min !== undefined && v < opts.min) issues.push({ path, message: `${path} must be at least ${opts.min}; got ${v}.` });
  if (opts.max !== undefined && v > opts.max) issues.push({ path, message: `${path} must be at most ${opts.max}; got ${v}.` });
}

function checkOptionalInt(path: string, v: unknown, issues: ValidationIssue[], opts: { min?: number; max?: number } = {}): void {
  if (v === null || v === undefined) return;
  checkRequiredInt(path, v, issues, opts);
}

/** Push an issue and report failure for a duplicate ID within one
 * collection, keyed by (containerPath, id) so it's meaningful across
 * every entity type this is reused for (paint variants, other materials,
 * service definitions, projects, and — per project — revisions, and per
 * revision — rooms and surfaces). */
function checkNoDuplicateIds(containerPath: string, items: unknown[], issues: ValidationIssue[]): void {
  const seen = new Set<unknown>();
  for (const item of items) {
    // A null/non-object/missing-id entry is reported by that item's own
    // shape validator elsewhere — this check only ever compares real IDs.
    if (!isPlainObject(item) || item.id === undefined) continue;
    if (seen.has(item.id)) issues.push({ path: `${containerPath}[${String(item.id)}]`, message: `Duplicate ID "${String(item.id)}" in ${containerPath}.` });
    seen.add(item.id);
  }
}

function validateBusinessSettings(path: string, raw: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `Expected a business settings object at ${path}.` });
    return;
  }
  checkRequiredString(`${path}.id`, raw.id, issues);
  checkOptionalPositiveDivisorDecimal(`${path}.loadedHourlyRate`, raw.loadedHourlyRate, issues);
  checkRequiredNonNegativeDecimal(`${path}.overheadRatio`, raw.overheadRatio, issues);
  checkRequiredNonNegativeDecimal(`${path}.targetMarginRatio`, raw.targetMarginRatio, issues);
  checkRequiredInt(`${path}.defaultCoats`, raw.defaultCoats, issues, { min: 1, max: 5 });
  checkRequiredNonNegativeDecimal(`${path}.defaultWasteRatio`, raw.defaultWasteRatio, issues);
  checkOptionalPositiveDivisorDecimal(`${path}.wallThroughput`, raw.wallThroughput, issues);
  checkOptionalPositiveDivisorDecimal(`${path}.ceilingThroughput`, raw.ceilingThroughput, issues);
  checkOptionalPositiveDivisorDecimal(`${path}.trimThroughput`, raw.trimThroughput, issues);
  checkOptionalPositiveDivisorDecimal(`${path}.doorHoursPerSidePerCoat`, raw.doorHoursPerSidePerCoat, issues);
  checkRequiredNonNegativeDecimal(`${path}.defaultTravelAmount`, raw.defaultTravelAmount, issues);
  checkRequiredBoolean(`${path}.sampleAssumptionsConfirmed`, raw.sampleAssumptionsConfirmed, issues);
  if (!isPlainObject(raw.defaultSuppliesAllowance)) {
    issues.push({ path: `${path}.defaultSuppliesAllowance`, message: `Expected an object at ${path}.defaultSuppliesAllowance.` });
  } else {
    checkEnum(`${path}.defaultSuppliesAllowance.mode`, raw.defaultSuppliesAllowance.mode, SUPPLIES_MODES, issues);
    checkRequiredNonNegativeDecimal(`${path}.defaultSuppliesAllowance.amount`, raw.defaultSuppliesAllowance.amount, issues);
    checkRequiredNonNegativeDecimal(`${path}.defaultSuppliesAllowance.ratio`, raw.defaultSuppliesAllowance.ratio, issues);
  }
}

function validatePaintVariant(path: string, raw: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `Expected a paint variant object at ${path}.` });
    return;
  }
  checkRequiredString(`${path}.id`, raw.id, issues);
  checkRequiredString(`${path}.name`, raw.name, issues);
  checkRequiredString(`${path}.color`, raw.color, issues);
  checkRequiredString(`${path}.sheen`, raw.sheen, issues);
  checkRequiredNonNegativeDecimal(`${path}.pricePerGal`, raw.pricePerGal, issues);
  checkRequiredPositiveDivisorDecimal(`${path}.coverageFt2PerGal`, raw.coverageFt2PerGal, issues);
  if (raw.purchaseIncrementGal !== '1') issues.push({ path: `${path}.purchaseIncrementGal`, message: `purchaseIncrementGal must be the literal string "1"; got "${String(raw.purchaseIncrementGal)}".` });
}

function validateOtherMaterial(path: string, raw: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `Expected an other-material object at ${path}.` });
    return;
  }
  checkRequiredString(`${path}.id`, raw.id, issues);
  checkRequiredString(`${path}.name`, raw.name, issues);
  checkRequiredString(`${path}.unit`, raw.unit, issues);
  checkRequiredNonNegativeDecimal(`${path}.unitCost`, raw.unitCost, issues);
}

function validateServiceDefinition(path: string, raw: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `Expected a service definition object at ${path}.` });
    return;
  }
  checkRequiredString(`${path}.id`, raw.id, issues);
  checkRequiredString(`${path}.name`, raw.name, issues);
  checkEnum(`${path}.unit`, raw.unit, SERVICE_UNITS, issues);
  checkEnum(`${path}.kind`, raw.kind, SERVICE_KINDS, issues);
  checkOptionalString(`${path}.paintVariantId`, raw.paintVariantId, issues);
  checkOptionalInt(`${path}.coats`, raw.coats, issues, { min: 1, max: 5 });
  if (raw.wasteRatio !== null) checkOptionalNonNegativeDecimal(`${path}.wasteRatio`, raw.wasteRatio, issues);
  checkOptionalPositiveDivisorDecimal(`${path}.loadedHourlyRate`, raw.loadedHourlyRate, issues);
  checkOptionalPositiveDivisorDecimal(`${path}.throughput`, raw.throughput, issues);
  checkOptionalPositiveDivisorDecimal(`${path}.hoursPerSidePerCoat`, raw.hoursPerSidePerCoat, issues);
  checkOptionalNonNegativeDecimal(`${path}.developedWidthFt`, raw.developedWidthFt, issues);
  checkOptionalNonNegativeDecimal(`${path}.widthFt`, raw.widthFt, issues);
  checkOptionalNonNegativeDecimal(`${path}.heightFt`, raw.heightFt, issues);
  if (raw.paintedSides !== null && raw.paintedSides !== 1 && raw.paintedSides !== 2) {
    issues.push({ path: `${path}.paintedSides`, message: `paintedSides must be 1, 2, or null; got ${String(raw.paintedSides)}.` });
  }
  checkRequiredNonNegativeDecimal(`${path}.additionalLaborHoursPerUnit`, raw.additionalLaborHoursPerUnit, issues);
  checkRequiredNonNegativeDecimal(`${path}.suppliesCostPerUnit`, raw.suppliesCostPerUnit, issues);
  checkRequiredNonNegativeDecimal(`${path}.directExpensePerUnit`, raw.directExpensePerUnit, issues);
  checkOptionalNonNegativeDecimal(`${path}.currentSellingPrice`, raw.currentSellingPrice, issues);
}

function validateRoom(path: string, raw: unknown, surfaceIdsInRevision: Set<string>, issues: ValidationIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `Expected a room object at ${path}.` });
    return;
  }
  checkRequiredString(`${path}.id`, raw.id, issues);
  checkRequiredString(`${path}.name`, raw.name, issues);
  checkOptionalNonNegativeDecimal(`${path}.lengthFt`, raw.lengthFt, issues);
  checkOptionalNonNegativeDecimal(`${path}.widthFt`, raw.widthFt, issues);
  checkOptionalNonNegativeDecimal(`${path}.heightFt`, raw.heightFt, issues);
  checkRequiredBoolean(`${path}.deductionEnabled`, raw.deductionEnabled, issues);
  checkEnum(`${path}.openingMode`, raw.openingMode, OPENING_MODES, issues);
  if (!isPlainObject(raw.quick)) {
    issues.push({ path: `${path}.quick`, message: `Expected an object at ${path}.quick.` });
  } else {
    checkRequiredInt(`${path}.quick.doorCount`, raw.quick.doorCount, issues, { min: 0 });
    checkRequiredInt(`${path}.quick.windowCount`, raw.quick.windowCount, issues, { min: 0 });
    checkRequiredNonNegativeDecimal(`${path}.quick.doorAreaEach`, raw.quick.doorAreaEach, issues);
    checkRequiredNonNegativeDecimal(`${path}.quick.windowAreaEach`, raw.quick.windowAreaEach, issues);
  }
  if (!Array.isArray(raw.openings)) {
    issues.push({ path: `${path}.openings`, message: `Expected an array at ${path}.openings.` });
  } else {
    raw.openings.forEach((opening, i) => {
      const openingPath = `${path}.openings[${i}]`;
      if (!isPlainObject(opening)) {
        issues.push({ path: openingPath, message: `Expected an opening entry object at ${openingPath}.` });
        return;
      }
      checkRequiredString(`${openingPath}.id`, opening.id, issues);
      checkEnum(`${openingPath}.type`, opening.type, OPENING_TYPES, issues);
      checkRequiredNonNegativeDecimal(`${openingPath}.widthFt`, opening.widthFt, issues);
      checkRequiredNonNegativeDecimal(`${openingPath}.heightFt`, opening.heightFt, issues);
      checkRequiredInt(`${openingPath}.count`, opening.count, issues, { min: 0 });
    });
  }
  if (!Array.isArray(raw.surfaceIds)) {
    issues.push({ path: `${path}.surfaceIds`, message: `Expected an array at ${path}.surfaceIds.` });
  } else {
    raw.surfaceIds.forEach((sid, i) => {
      if (typeof sid !== 'string' || !surfaceIdsInRevision.has(sid)) {
        issues.push({ path: `${path}.surfaceIds[${i}]`, message: `Dangling reference: room surfaceIds entry "${String(sid)}" does not match any surface in this revision.` });
      }
    });
  }
}

function validateSurface(path: string, raw: unknown, roomIdsInRevision: Set<string>, issues: ValidationIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `Expected a surface object at ${path}.` });
    return;
  }
  checkRequiredString(`${path}.id`, raw.id, issues);
  if (raw.roomId !== null) {
    checkRequiredString(`${path}.roomId`, raw.roomId, issues);
    if (typeof raw.roomId === 'string' && !roomIdsInRevision.has(raw.roomId)) {
      issues.push({ path: `${path}.roomId`, message: `Dangling reference: surface roomId "${raw.roomId}" does not match any room in this revision.` });
    }
  }
  checkEnum(`${path}.kind`, raw.kind, SERVICE_KINDS, issues);
  checkRequiredBoolean(`${path}.enabled`, raw.enabled, issues);
  checkEnum(`${path}.measurementMode`, raw.measurementMode, MEASUREMENT_MODES, issues);
  checkOptionalNonNegativeDecimal(`${path}.areaFt2`, raw.areaFt2, issues);
  checkOptionalNonNegativeDecimal(`${path}.trimLengthFt`, raw.trimLengthFt, issues);
  checkOptionalNonNegativeDecimal(`${path}.developedWidthFt`, raw.developedWidthFt, issues);
  checkOptionalInt(`${path}.doorCount`, raw.doorCount, issues, { min: 0 });
  checkOptionalNonNegativeDecimal(`${path}.widthFt`, raw.widthFt, issues);
  checkOptionalNonNegativeDecimal(`${path}.heightFt`, raw.heightFt, issues);
  if (raw.paintedSides !== null && raw.paintedSides !== 1 && raw.paintedSides !== 2) {
    issues.push({ path: `${path}.paintedSides`, message: `paintedSides must be 1, 2, or null; got ${String(raw.paintedSides)}.` });
  }
  checkOptionalString(`${path}.paintVariantId`, raw.paintVariantId, issues);
  checkOptionalInt(`${path}.coats`, raw.coats, issues, { min: 1, max: 5 });
  if (raw.wasteRatio !== null) checkOptionalNonNegativeDecimal(`${path}.wasteRatio`, raw.wasteRatio, issues);
  checkOptionalPositiveDivisorDecimal(`${path}.loadedHourlyRate`, raw.loadedHourlyRate, issues);
  checkOptionalPositiveDivisorDecimal(`${path}.throughput`, raw.throughput, issues);
  checkOptionalPositiveDivisorDecimal(`${path}.hoursPerSidePerCoat`, raw.hoursPerSidePerCoat, issues);
}

function validateExpenseLine(path: string, raw: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `Expected an expense line object at ${path}.` });
    return;
  }
  checkRequiredString(`${path}.id`, raw.id, issues);
  checkRequiredString(`${path}.description`, raw.description, issues);
  checkRequiredNonNegativeDecimal(`${path}.amount`, raw.amount, issues);
}

function validateAdditionalLaborLine(path: string, raw: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `Expected an additional-labor line object at ${path}.` });
    return;
  }
  checkRequiredString(`${path}.id`, raw.id, issues);
  checkRequiredString(`${path}.description`, raw.description, issues);
  checkRequiredNonNegativeDecimal(`${path}.hours`, raw.hours, issues);
  checkRequiredPositiveDivisorDecimal(`${path}.loadedHourlyRate`, raw.loadedHourlyRate, issues);
}

function validateOtherMaterialLine(path: string, raw: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `Expected an other-material line object at ${path}.` });
    return;
  }
  checkRequiredString(`${path}.id`, raw.id, issues);
  checkRequiredString(`${path}.description`, raw.description, issues);
  checkOptionalString(`${path}.sourceMaterialId`, raw.sourceMaterialId, issues);
  checkRequiredString(`${path}.unit`, raw.unit, issues);
  checkRequiredNonNegativeDecimal(`${path}.quantity`, raw.quantity, issues);
  checkRequiredNonNegativeDecimal(`${path}.unitCost`, raw.unitCost, issues);
}

function validateSuppliesAllowance(path: string, raw: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `Expected a supplies-allowance object at ${path}.` });
    return;
  }
  checkEnum(`${path}.mode`, raw.mode, SUPPLIES_MODES, issues);
  checkRequiredNonNegativeDecimal(`${path}.amount`, raw.amount, issues);
  checkRequiredNonNegativeDecimal(`${path}.ratio`, raw.ratio, issues);
}

function validateRateSnapshot(path: string, raw: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `Expected a rate snapshot object at ${path}.` });
    return;
  }
  checkRequiredString(`${path}.id`, raw.id, issues);
  checkRequiredString(`${path}.capturedAt`, raw.capturedAt, issues);
  checkRequiredString(`${path}.sourceSettingsId`, raw.sourceSettingsId, issues);
  checkRequiredString(`${path}.sourceCatalogRevision`, raw.sourceCatalogRevision, issues);
  checkRequiredString(`${path}.engineVersion`, raw.engineVersion, issues);
  validateBusinessSettings(`${path}.businessSettings`, raw.businessSettings, issues);
  if (!Array.isArray(raw.paintVariants)) issues.push({ path: `${path}.paintVariants`, message: `Expected an array at ${path}.paintVariants.` });
  else raw.paintVariants.forEach((v, i) => validatePaintVariant(`${path}.paintVariants[${i}]`, v, issues));
  if (!Array.isArray(raw.otherMaterials)) issues.push({ path: `${path}.otherMaterials`, message: `Expected an array at ${path}.otherMaterials.` });
  else raw.otherMaterials.forEach((m, i) => validateOtherMaterial(`${path}.otherMaterials[${i}]`, m, issues));
}

function validateActualReview(path: string, raw: unknown, revisionsById: Map<string, { state: unknown }>, issues: ValidationIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `Expected an actual review object at ${path}.` });
    return;
  }
  checkRequiredString(`${path}.id`, raw.id, issues);
  checkRequiredString(`${path}.projectId`, raw.projectId, issues);
  checkEnum(`${path}.state`, raw.state, ACTUAL_REVIEW_STATES, issues);
  checkRequiredString(`${path}.updatedAt`, raw.updatedAt, issues);

  const validateCategory = (categoryPath: string, category: unknown) => {
    if (!isPlainObject(category)) {
      issues.push({ path: categoryPath, message: `Expected a category object at ${categoryPath}.` });
      return;
    }
    checkRequiredBoolean(`${categoryPath}.confirmed`, category.confirmed, issues);
    // A cost cannot be negative — but this is the ONLY thing checked here.
    // The engine's own DERIVED profit/margin from these costs legitimately
    // goes negative (a real loss) and must never be rejected; that
    // computation happens elsewhere and is not a stored field at all.
    checkOptionalNonNegativeDecimal(`${categoryPath}.amount`, category.amount, issues);
  };
  validateCategory(`${path}.materials`, raw.materials);
  validateCategory(`${path}.labor`, raw.labor);
  validateCategory(`${path}.otherExpenses`, raw.otherExpenses);
  if (!isPlainObject(raw.overhead)) {
    issues.push({ path: `${path}.overhead`, message: `Expected an object at ${path}.overhead.` });
  } else {
    validateCategory(`${path}.overhead`, raw.overhead);
    checkEnum(`${path}.overhead.mode`, raw.overhead.mode, OVERHEAD_MODES, issues);
  }
  if (raw.laborBreakdown !== undefined && raw.laborBreakdown !== null) {
    if (!isPlainObject(raw.laborBreakdown)) {
      issues.push({ path: `${path}.laborBreakdown`, message: `Expected an object at ${path}.laborBreakdown.` });
    } else {
      checkEnum(`${path}.laborBreakdown.mode`, raw.laborBreakdown.mode, LABOR_BREAKDOWN_MODES, issues);
    }
  }

  // BACK-015 (existence) + item 5's explicit "an actual review targeting a
  // draft" case: the baseline must exist in this project AND must actually
  // be an ISSUED revision — CALCULATION_SPEC/DATA_CONTRACT's "actual
  // reviews stay linked to the chosen ISSUED revision," never a draft,
  // which can still be edited or discarded and has no frozen customer
  // document to compare actuals against.
  const baselineId = raw.baselineIssuedRevisionId;
  const baseline = typeof baselineId === 'string' ? revisionsById.get(baselineId) : undefined;
  if (!baseline) {
    issues.push({ path: `${path}.baselineIssuedRevisionId`, message: `Dangling reference: actual review baseline "${String(baselineId)}" does not match any revision in this project.` });
  } else if (baseline.state !== 'issued') {
    issues.push({ path: `${path}.baselineIssuedRevisionId`, message: `Actual review baseline "${String(baselineId)}" targets a revision in state "${String(baseline.state)}", not "issued" — actual reviews may only be linked to an issued baseline.` });
  }
}

/** DATA_CONTRACT.md "Backup envelope" + "Import modes". */

export function exportBackup(
  installationId: string,
  businessSettings: BusinessSettings,
  paintVariants: PaintVariant[],
  otherMaterials: OtherMaterial[],
  serviceDefinitions: ServiceDefinition[],
  projects: Project[],
  ids: IdSource,
  // ITEM 6 REGRESSION: this used to be hardcoded to `[]`, silently
  // discarding every previously-accumulated provenance record on each new
  // export. Defaults to `[]` only for an installation with no import
  // history yet — a real caller with existing provenance must pass it
  // through so "already imported this export" detection survives an
  // export/reimport round trip.
  importProvenance: ImportProvenanceRecord[] = []
): BackupEnvelope {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportId: ids.nextId(),
    exportedAt: ids.now(),
    installationId,
    engineVersion: ENGINE_VERSION,
    businessSettings: structuredClone(businessSettings),
    paintVariants: structuredClone(paintVariants),
    otherMaterials: structuredClone(otherMaterials),
    serviceDefinitions: structuredClone(serviceDefinitions),
    projects: structuredClone(projects),
    importProvenance: structuredClone(importProvenance),
  };
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/** Full-shape validation BEFORE any write — D11: "failed/truncated/invalid
 * version/dangling reference/duplicate ID/oversized import -> no writes." */
export function validateBackupEnvelope(raw: unknown, rawByteLength: number): { ok: true; envelope: BackupEnvelope } | { ok: false; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (rawByteLength > MAX_IMPORT_BYTES) issues.push({ path: '$', message: `File exceeds the ${MAX_IMPORT_BYTES} byte import limit.` });
  if (typeof raw !== 'object' || raw === null) {
    issues.push({ path: '$', message: 'Backup file is not a JSON object.' });
    return { ok: false, issues };
  }
  const env = raw as Partial<BackupEnvelope>;
  if (env.schemaVersion === undefined) issues.push({ path: 'schemaVersion', message: 'Missing schemaVersion.' });
  else if (env.schemaVersion !== SCHEMA_VERSION) {
    issues.push({ path: 'schemaVersion', message: `Unsupported schemaVersion ${env.schemaVersion}; this build supports ${SCHEMA_VERSION} only. No silent migration.` });
  }
  checkRequiredString('exportId', env.exportId, issues);
  checkRequiredString('exportedAt', env.exportedAt, issues);
  checkRequiredString('installationId', env.installationId, issues);
  checkRequiredString('engineVersion', env.engineVersion, issues);
  validateBusinessSettings('businessSettings', env.businessSettings, issues);

  if (!Array.isArray(env.paintVariants)) {
    issues.push({ path: 'paintVariants', message: 'paintVariants must be an array.' });
  } else {
    checkNoDuplicateIds('paintVariants', env.paintVariants as { id: unknown }[], issues);
    env.paintVariants.forEach((v, i) => validatePaintVariant(`paintVariants[${i}]`, v, issues));
  }

  if (!Array.isArray(env.otherMaterials)) {
    issues.push({ path: 'otherMaterials', message: 'otherMaterials must be an array.' });
  } else {
    checkNoDuplicateIds('otherMaterials', env.otherMaterials as { id: unknown }[], issues);
    env.otherMaterials.forEach((m, i) => validateOtherMaterial(`otherMaterials[${i}]`, m, issues));
  }

  if (!Array.isArray(env.serviceDefinitions)) {
    issues.push({ path: 'serviceDefinitions', message: 'serviceDefinitions must be an array.' });
  } else {
    checkNoDuplicateIds('serviceDefinitions', env.serviceDefinitions as { id: unknown }[], issues);
    env.serviceDefinitions.forEach((s, i) => validateServiceDefinition(`serviceDefinitions[${i}]`, s, issues));
  }

  if (!Array.isArray(env.importProvenance)) {
    issues.push({ path: 'importProvenance', message: 'importProvenance must be an array.' });
  } else {
    env.importProvenance.forEach((rec, i) => {
      const path = `importProvenance[${i}]`;
      if (!isPlainObject(rec)) {
        issues.push({ path, message: `Expected a provenance record object at ${path}.` });
        return;
      }
      checkRequiredString(`${path}.exportId`, rec.exportId, issues);
      checkRequiredString(`${path}.sourceProjectId`, rec.sourceProjectId, issues);
      checkRequiredString(`${path}.copiedProjectId`, rec.copiedProjectId, issues);
      checkRequiredString(`${path}.importedAt`, rec.importedAt, issues);
    });
  }

  if (!Array.isArray(env.projects)) {
    issues.push({ path: 'projects', message: 'projects must be an array.' });
  } else {
    checkNoDuplicateIds('projects', env.projects as { id: unknown }[], issues);
    env.projects.forEach((p, projectIndex) => {
      const projectPath = `projects[${projectIndex}]`;
      if (!isPlainObject(p)) {
        issues.push({ path: projectPath, message: `Expected a project object at ${projectPath}.` });
        return;
      }
      const projectId = typeof p.id === 'string' ? p.id : `#${projectIndex}`;
      const path = `projects[${projectId}]`;
      checkRequiredString(`${path}.id`, p.id, issues);
      checkRequiredString(`${path}.title`, p.title, issues);
      checkRequiredString(`${path}.createdAt`, p.createdAt, issues);
      checkRequiredString(`${path}.updatedAt`, p.updatedAt, issues);
      checkRequiredInt(`${path}.version`, p.version, issues, { min: 1 });

      if (!Array.isArray(p.revisions) || p.revisions.length === 0) {
        issues.push({ path: `${path}.revisions`, message: `${path}.revisions must be a non-empty array.` });
        return; // nothing else in this project can be meaningfully cross-checked
      }
      checkNoDuplicateIds(`${path}.revisions`, p.revisions as { id: unknown }[], issues);

      const revisionsById = new Map<string, { state: unknown }>();
      for (const rev of p.revisions) {
        if (isPlainObject(rev) && typeof rev.id === 'string') revisionsById.set(rev.id, { state: rev.state });
      }

      p.revisions.forEach((rev, revIndex) => {
        const revPath = `${path}.revisions[${revIndex}]`;
        if (!isPlainObject(rev)) {
          issues.push({ path: revPath, message: `Expected a revision object at ${revPath}.` });
          return;
        }
        checkRequiredString(`${revPath}.id`, rev.id, issues);
        if (rev.projectId !== p.id) {
          issues.push({ path: `${revPath}.projectId`, message: `Revision projectId "${String(rev.projectId)}" does not match its containing project "${String(p.id)}".` });
        }
        checkRequiredInt(`${revPath}.revisionNumber`, rev.revisionNumber, issues, { min: 1 });
        checkEnum(`${revPath}.state`, rev.state, REVISION_STATES, issues);
        checkRequiredString(`${revPath}.title`, rev.title, issues);
        checkRequiredString(`${revPath}.createdAt`, rev.createdAt, issues);
        checkRequiredString(`${revPath}.updatedAt`, rev.updatedAt, issues);
        checkRequiredString(`${revPath}.engineVersion`, rev.engineVersion, issues);
        checkEnum(`${revPath}.calculationState`, rev.calculationState, CALCULATION_STATES, issues);
        checkEnum(`${revPath}.priceMode`, rev.priceMode, PRICE_MODES, issues);
        checkOptionalNonNegativeDecimal(`${revPath}.proposedPrice`, rev.proposedPrice, issues);
        checkOptionalString(`${revPath}.issuedAt`, rev.issuedAt, issues);

        if (!isPlainObject(rev.businessInfo)) issues.push({ path: `${revPath}.businessInfo`, message: `Expected an object at ${revPath}.businessInfo.` });
        else {
          checkRequiredString(`${revPath}.businessInfo.name`, rev.businessInfo.name, issues);
          checkRequiredString(`${revPath}.businessInfo.contact`, rev.businessInfo.contact, issues);
          checkRequiredString(`${revPath}.businessInfo.address`, rev.businessInfo.address, issues);
        }
        if (!isPlainObject(rev.customerInfo)) issues.push({ path: `${revPath}.customerInfo`, message: `Expected an object at ${revPath}.customerInfo.` });
        else {
          checkRequiredString(`${revPath}.customerInfo.name`, rev.customerInfo.name, issues);
          checkRequiredString(`${revPath}.customerInfo.address`, rev.customerInfo.address, issues);
          checkRequiredString(`${revPath}.customerInfo.contact`, rev.customerInfo.contact, issues);
        }

        if (!rev.activeRateSnapshot) issues.push({ path: `${revPath}.activeRateSnapshot`, message: 'Revision missing embedded rate snapshot.' });
        else validateRateSnapshot(`${revPath}.activeRateSnapshot`, rev.activeRateSnapshot, issues);

        // Surfaces are validated before rooms so rooms can cross-reference
        // the resulting ID set (surfaceIds -> real surfaces in this revision).
        const surfaceIds = new Set<string>();
        if (!Array.isArray(rev.surfaces)) {
          issues.push({ path: `${revPath}.surfaces`, message: `Expected an array at ${revPath}.surfaces.` });
        } else {
          for (const s of rev.surfaces) if (isPlainObject(s) && typeof s.id === 'string') surfaceIds.add(s.id);
          checkNoDuplicateIds(`${revPath}.surfaces`, rev.surfaces as { id: unknown }[], issues);
        }
        const roomIds = new Set<string>();
        if (Array.isArray(rev.rooms)) for (const r of rev.rooms) if (isPlainObject(r) && typeof r.id === 'string') roomIds.add(r.id);

        if (Array.isArray(rev.surfaces)) rev.surfaces.forEach((s, i) => validateSurface(`${revPath}.surfaces[${i}]`, s, roomIds, issues));

        if (!Array.isArray(rev.rooms)) {
          issues.push({ path: `${revPath}.rooms`, message: `Expected an array at ${revPath}.rooms.` });
        } else {
          checkNoDuplicateIds(`${revPath}.rooms`, rev.rooms as { id: unknown }[], issues);
          rev.rooms.forEach((r, i) => validateRoom(`${revPath}.rooms[${i}]`, r, surfaceIds, issues));
        }

        if (!Array.isArray(rev.additionalLabor)) issues.push({ path: `${revPath}.additionalLabor`, message: `Expected an array at ${revPath}.additionalLabor.` });
        else rev.additionalLabor.forEach((l, i) => validateAdditionalLaborLine(`${revPath}.additionalLabor[${i}]`, l, issues));

        if (!Array.isArray(rev.otherMaterialLines)) issues.push({ path: `${revPath}.otherMaterialLines`, message: `Expected an array at ${revPath}.otherMaterialLines.` });
        else rev.otherMaterialLines.forEach((l, i) => validateOtherMaterialLine(`${revPath}.otherMaterialLines[${i}]`, l, issues));

        validateSuppliesAllowance(`${revPath}.suppliesAllowance`, rev.suppliesAllowance, issues);

        if (!Array.isArray(rev.otherExpenses)) issues.push({ path: `${revPath}.otherExpenses`, message: `Expected an array at ${revPath}.otherExpenses.` });
        else rev.otherExpenses.forEach((l, i) => validateExpenseLine(`${revPath}.otherExpenses[${i}]`, l, issues));
      });

      // Project ownership: activeRevisionId must reference one of this
      // project's OWN revisions — a dangling active pointer would leave the
      // UI unable to open the project at all.
      if (typeof p.activeRevisionId !== 'string' || !revisionsById.has(p.activeRevisionId)) {
        issues.push({ path: `${path}.activeRevisionId`, message: `Dangling reference: activeRevisionId "${String(p.activeRevisionId)}" does not match any revision in this project.` });
      }

      if (!Array.isArray(p.actualReviews)) {
        issues.push({ path: `${path}.actualReviews`, message: `${path}.actualReviews must be an array.` });
      } else {
        checkNoDuplicateIds(`${path}.actualReviews`, p.actualReviews as { id: unknown }[], issues);
        p.actualReviews.forEach((ar, i) => validateActualReview(`${path}.actualReviews[${i}]`, ar, revisionsById, issues));
      }
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, envelope: raw as BackupEnvelope };
}

export type ImportMode = 'restoreMerge' | 'importAsCopies' | 'replaceAll';

export interface ImportConflict {
  kind: 'project' | 'businessSettings' | 'paintVariant' | 'otherMaterial' | 'serviceDefinition';
  id: string;
  resolution: 'keepLocal' | 'replaceImported' | 'keepBoth';
}

export interface ImportPlan {
  mode: ImportMode;
  toAdd: { projects: Project[] };
  toSkip: { projectIds: string[] };
  conflicts: ImportConflict[];
}

export interface ArrayMergeResult<T> {
  toAdd: T[];
  toSkip: string[]; // ids
  conflicts: { id: string; resolution: 'keepLocal' | 'replaceImported' | 'keepBoth' }[];
}

/** Generic "identical existing records skip; new IDs add; conflicting
 * content at the same ID needs an explicit resolution (default keepLocal,
 * never an automatic timestamp-wins rule)" merge, usable for any
 * ID-keyed record collection (projects, paint variants, ...). */
export function planArrayMerge<T extends { id: string }>(existing: T[], incoming: T[]): ArrayMergeResult<T> {
  const existingById = new Map(existing.map((e) => [e.id, e]));
  const toAdd: T[] = [];
  const toSkip: string[] = [];
  const conflicts: ArrayMergeResult<T>['conflicts'] = [];

  for (const item of incoming) {
    const match = existingById.get(item.id);
    if (!match) {
      toAdd.push(item);
      continue;
    }
    if (JSON.stringify(match) === JSON.stringify(item)) {
      toSkip.push(item.id); // identical -> skip, not a duplicate
    } else {
      conflicts.push({ id: item.id, resolution: 'keepLocal' }); // default; caller may override
    }
  }

  return { toAdd, toSkip, conflicts };
}

/** Restore/merge (default): identical existing records skip; new IDs add;
 * conflicting content at the same ID needs an explicit resolution
 * (default keepLocal, never an automatic timestamp-wins rule). */
export function planRestoreMerge(existingProjects: Project[], incomingProjects: Project[]): ImportPlan {
  const generic = planArrayMerge(existingProjects, incomingProjects);
  return {
    mode: 'restoreMerge',
    toAdd: { projects: generic.toAdd },
    toSkip: { projectIds: generic.toSkip },
    conflicts: generic.conflicts.map((c) => ({ kind: 'project' as const, id: c.id, resolution: c.resolution })),
  };
}

export interface FullRestorePlan {
  toAdd: { projects: Project[]; paintVariants: PaintVariant[] };
  toSkip: { projectIds: string[]; paintVariantIds: string[] };
  /** Every conflict a confirmation UI must resolve before any write —
   * spans projects, the paint catalog, and (at most one, since it's a
   * singleton) business settings. */
  conflicts: ImportConflict[];
}

/** The full restore/merge plan across every mergeable collection in a
 * backup envelope — item 5: "Implement required conflict preview,
 * available conflict choices, confirmation, and cancellation for backup
 * import." Business settings is a singleton, not an ID-keyed collection,
 * so it is compared directly: identical is silently fine, any difference
 * is one conflict (default keepLocal, same as every other kind). */
export function planFullRestoreMerge(
  existing: { businessSettings: BusinessSettings; paintVariants: PaintVariant[]; projects: Project[] },
  incoming: { businessSettings: BusinessSettings; paintVariants: PaintVariant[]; projects: Project[] }
): FullRestorePlan {
  const projectMerge = planArrayMerge(existing.projects, incoming.projects);
  const variantMerge = planArrayMerge(existing.paintVariants, incoming.paintVariants);
  const conflicts: ImportConflict[] = [
    ...projectMerge.conflicts.map((c) => ({ kind: 'project' as const, id: c.id, resolution: c.resolution })),
    ...variantMerge.conflicts.map((c) => ({ kind: 'paintVariant' as const, id: c.id, resolution: c.resolution })),
  ];
  if (JSON.stringify(existing.businessSettings) !== JSON.stringify(incoming.businessSettings)) {
    conflicts.push({ kind: 'businessSettings', id: existing.businessSettings.id, resolution: 'keepLocal' });
  }
  return {
    toAdd: { projects: projectMerge.toAdd, paintVariants: variantMerge.toAdd },
    toSkip: { projectIds: projectMerge.toSkip, paintVariantIds: variantMerge.toSkip },
    conflicts,
  };
}

/** Import as copies: new IDs throughout each imported graph, remapping
 * every internal link (rooms, surfaces, actual-review baseline). Skips by
 * provenance on repeat import of the SAME export unless the user
 * explicitly asks for another copy. */
export function planImportAsCopies(
  incomingProjects: Project[],
  exportId: string,
  alreadyImportedSourceIds: Set<string>,
  ids: IdSource,
  forceAnotherCopy = false
): { projects: Project[]; skippedSourceIds: string[]; provenance: { exportId: string; sourceProjectId: string; copiedProjectId: string; importedAt: string }[] } {
  const projects: Project[] = [];
  const skippedSourceIds: string[] = [];
  const provenance: { exportId: string; sourceProjectId: string; copiedProjectId: string; importedAt: string }[] = [];

  for (const source of incomingProjects) {
    if (!forceAnotherCopy && alreadyImportedSourceIds.has(source.id)) {
      skippedSourceIds.push(source.id);
      continue;
    }
    const remapped = remapProjectIds(source, ids);
    projects.push(remapped);
    provenance.push({ exportId, sourceProjectId: source.id, copiedProjectId: remapped.id, importedAt: ids.now() });
  }

  return { projects, skippedSourceIds, provenance };
}

/** Remaps every child entity ID WITHIN one revision's own graph (rooms,
 * surfaces, opening entries, and the three line-item arrays) and rewires
 * the room<->surface cross-references to the new IDs — item 6: "Copied
 * rooms, surfaces, and snapshots retain IDs that should be remapped."
 * `paintVariantId`/`sourceMaterialId` are deliberately left untouched:
 * they're legitimate references into the LIVE, shared paint/material
 * catalog, not part of this project's own copied graph (the same
 * principle already applied to a surface's paintVariantId when its
 * catalog entry is deleted — resolved through the embedded snapshot, not
 * remapped or invalidated). */
function remapRevisionChildIds(rev: Project['revisions'][number], ids: IdSource): Project['revisions'][number] {
  const surfaceIdMap = new Map(rev.surfaces.map((s) => [s.id, ids.nextId()]));
  const roomIdMap = new Map(rev.rooms.map((r) => [r.id, ids.nextId()]));

  const newSurfaces = rev.surfaces.map((s) => ({
    ...structuredClone(s),
    id: surfaceIdMap.get(s.id)!,
    roomId: s.roomId ? (roomIdMap.get(s.roomId) ?? null) : null,
  }));
  const newRooms = rev.rooms.map((r) => ({
    ...structuredClone(r),
    id: roomIdMap.get(r.id)!,
    openings: r.openings.map((o) => ({ ...structuredClone(o), id: ids.nextId() })),
    surfaceIds: r.surfaceIds.map((sid) => surfaceIdMap.get(sid)).filter((sid): sid is string => sid !== undefined),
  }));

  return {
    ...structuredClone(rev),
    rooms: newRooms,
    surfaces: newSurfaces,
    additionalLabor: rev.additionalLabor.map((l) => ({ ...structuredClone(l), id: ids.nextId() })),
    otherMaterialLines: rev.otherMaterialLines.map((l) => ({ ...structuredClone(l), id: ids.nextId() })),
    otherExpenses: rev.otherExpenses.map((l) => ({ ...structuredClone(l), id: ids.nextId() })),
  };
}

function remapProjectIds(source: Project, ids: IdSource): Project {
  const newProjectId = ids.nextId();
  const revisionIdMap = new Map(source.revisions.map((r) => [r.id, ids.nextId()]));
  const newRevisions = source.revisions.map((rev) => ({
    ...remapRevisionChildIds(rev, ids),
    id: revisionIdMap.get(rev.id)!,
    projectId: newProjectId,
  }));
  // "New copied IDs remap all children/actual baselines, not only project
  // IDs." Import validation (BACK-015) already guarantees every source
  // actual review's baseline matches one of this project's own revisions,
  // so every lookup below should always hit — but if one somehow doesn't
  // (defense in depth), the review is dropped rather than carried over
  // with its old, now-meaningless baseline ID: "never retain a dangling
  // baseline reference as a fallback."
  const newActualReviews = source.actualReviews.flatMap((ar) => {
    const remappedBaselineId = revisionIdMap.get(ar.baselineIssuedRevisionId);
    if (!remappedBaselineId) return [];
    return [{
      ...structuredClone(ar),
      id: ids.nextId(),
      projectId: newProjectId,
      baselineIssuedRevisionId: remappedBaselineId,
    }];
  });
  return {
    ...structuredClone(source),
    id: newProjectId,
    revisions: newRevisions,
    activeRevisionId: revisionIdMap.get(source.activeRevisionId) ?? newRevisions[0]?.id,
    actualReviews: newActualReviews,
  };
}
