import type { BusinessSettings, PaintVariant, OtherMaterial, RateSnapshot } from './entities';
import { ENGINE_VERSION } from './entities';
import type { IdSource } from './ids';

/**
 * DATA_CONTRACT.md #1: "New draft copies current settings/catalog to its
 * activeRateSnapshot." This is a deep, self-contained copy — never a
 * pointer to the live BusinessSettings/PaintVariant records. This one
 * function is what makes requirement #1 ("saved estimates retain original
 * rates when the catalog changes") true: nothing downstream ever reads
 * live settings again once a snapshot exists, except through the explicit
 * refresh path in project.ts.
 */
export function createSnapshot(
  settings: BusinessSettings,
  paintVariants: PaintVariant[],
  otherMaterials: OtherMaterial[],
  ids: IdSource,
  catalogRevision: string
): RateSnapshot {
  return {
    id: ids.nextId(),
    capturedAt: ids.now(),
    sourceSettingsId: settings.id,
    sourceCatalogRevision: catalogRevision,
    engineVersion: ENGINE_VERSION,
    businessSettings: structuredClone(settings),
    paintVariants: structuredClone(paintVariants),
    otherMaterials: structuredClone(otherMaterials),
    serviceAssumptionsUsed: {},
  };
}

/** LIFE-D03: a snapshot must keep working even after the live catalog
 * deletes the variant it references — lookups against a snapshot NEVER
 * fall through to the live catalog. */
export function findVariantInSnapshot(snapshot: RateSnapshot, paintVariantId: string): PaintVariant | undefined {
  return snapshot.paintVariants.find((v) => v.id === paintVariantId);
}
