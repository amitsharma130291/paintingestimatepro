import type { EstimateRevision, RateSnapshot, PaintVariant } from './entities';
import type { IdSource } from './ids';

/**
 * Explicit rate refresh (task item 3/4). Nothing here runs automatically —
 * a caller always calls `previewRateRefresh` first to show the user what
 * would change, then only `applyRateRefresh` (on explicit confirm) actually
 * swaps the draft's snapshot. Cancel needs no special code: the caller just
 * discards the preview and keeps using the original (untouched) draft
 * object, since every function here returns a new object rather than
 * mutating its input — the same immutability guarantee issueRevision/
 * createDraftFromIssued rely on.
 */

const COMPARED_VARIANT_FIELDS: (keyof PaintVariant)[] = ['pricePerGal', 'coverageFt2PerGal', 'name', 'sheen', 'color'];
const COMPARED_SETTINGS_FIELDS = ['loadedHourlyRate', 'overheadRatio', 'targetMarginRatio', 'defaultWasteRatio', 'wallThroughput', 'ceilingThroughput', 'trimThroughput', 'doorHoursPerSidePerCoat'] as const;

export interface VariantFieldChange {
  variantId: string;
  variantName: string;
  field: string;
  oldValue: string;
  newValue: string;
}

export interface SettingsFieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface RateRefreshDiff {
  variantChanges: VariantFieldChange[];
  /** Variant IDs referenced by an enabled surface in this draft that no
   * longer exist in the live catalog — refresh cannot proceed for these
   * until the caller explicitly resolves each one (retain or replace). */
  missingVariantIds: string[];
  settingsChanges: SettingsFieldChange[];
}

export function previewRateRefresh(revision: EstimateRevision, liveSnapshot: RateSnapshot): RateRefreshDiff {
  const oldSnapshot = revision.activeRateSnapshot;
  const usedVariantIds = new Set(revision.surfaces.filter((s) => s.paintVariantId).map((s) => s.paintVariantId as string));
  const liveById = new Map(liveSnapshot.paintVariants.map((v) => [v.id, v]));

  const variantChanges: VariantFieldChange[] = [];
  const missingVariantIds: string[] = [];
  for (const variantId of usedVariantIds) {
    const oldVariant = oldSnapshot.paintVariants.find((v) => v.id === variantId);
    const liveVariant = liveById.get(variantId);
    if (!liveVariant) {
      missingVariantIds.push(variantId);
      continue;
    }
    if (!oldVariant) continue;
    for (const field of COMPARED_VARIANT_FIELDS) {
      if (oldVariant[field] !== liveVariant[field]) {
        variantChanges.push({ variantId, variantName: liveVariant.name, field, oldValue: String(oldVariant[field]), newValue: String(liveVariant[field]) });
      }
    }
  }

  const settingsChanges: SettingsFieldChange[] = [];
  for (const field of COMPARED_SETTINGS_FIELDS) {
    const oldValue = oldSnapshot.businessSettings[field];
    const newValue = liveSnapshot.businessSettings[field];
    if (oldValue !== newValue) settingsChanges.push({ field, oldValue, newValue });
  }

  return { variantChanges, missingVariantIds, settingsChanges };
}

export type VariantResolution = { variantId: string; action: 'retain' } | { variantId: string; action: 'replaceWith'; newVariantId: string };

/**
 * Applies a previewed refresh. `resolutions` must cover every ID in
 * `previewRateRefresh(...).missingVariantIds`, or this throws rather than
 * silently dropping a surface's paint reference. "retain" copies the OLD
 * variant record forward into the new snapshot (by value, not by pointer)
 * so the surface keeps resolving even though the live catalog moved on;
 * "replaceWith" repoints the surface itself at a live variant instead.
 * priceMode/proposedPrice are never touched here — custom-price
 * preservation falls out of that, not from a special case.
 */
export function applyRateRefresh(revision: EstimateRevision, liveSnapshot: RateSnapshot, resolutions: VariantResolution[], ids: IdSource): EstimateRevision {
  if (revision.state !== 'draft') {
    throw new Error('Rate refresh only applies to a draft revision — edit an issued revision by creating a new draft first.');
  }

  const diff = previewRateRefresh(revision, liveSnapshot);
  const resolutionByVariant = new Map(resolutions.map((r) => [r.variantId, r]));
  for (const missingId of diff.missingVariantIds) {
    if (!resolutionByVariant.has(missingId)) {
      throw new Error(`Rate refresh requires an explicit retain-or-replace choice for deleted variant "${missingId}".`);
    }
  }

  const newSnapshot: RateSnapshot = { ...structuredClone(liveSnapshot), id: ids.nextId(), capturedAt: ids.now() };
  const oldSnapshot = revision.activeRateSnapshot;

  for (const resolution of resolutions) {
    if (resolution.action === 'retain') {
      const oldVariant = oldSnapshot.paintVariants.find((v) => v.id === resolution.variantId);
      if (oldVariant && !newSnapshot.paintVariants.some((v) => v.id === oldVariant.id)) {
        newSnapshot.paintVariants.push(structuredClone(oldVariant));
      }
    }
  }

  const surfaces = revision.surfaces.map((s) => {
    if (!s.paintVariantId) return s;
    const resolution = resolutionByVariant.get(s.paintVariantId);
    if (resolution?.action === 'replaceWith') return { ...s, paintVariantId: resolution.newVariantId };
    return s;
  });

  return {
    ...structuredClone(revision),
    surfaces: structuredClone(surfaces),
    activeRateSnapshot: newSnapshot,
    updatedAt: ids.now(),
  };
}
