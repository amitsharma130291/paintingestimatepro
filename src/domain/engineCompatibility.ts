// BACK-026: engine-version compatibility policy.
//
// DECISION (see docs/ENGINE_VERSION_COMPATIBILITY.md for the full written
// rationale): frozen/issued data is ALWAYS read-only and safe to display
// regardless of which engine version produced it -- it is never
// recalculated, so an unrecognized engineVersion tag on it is purely
// informational. LIVE (draft) recalculation, by contrast, runs TODAY'S
// formulas against a stored RateSnapshot -- that is only safe when this
// build actually knows the snapshot's own engineVersion is compatible
// with today's formulas. An unrecognized version (most realistically: a
// newer build produced it, and an older build is now open) must never be
// silently recalculated as though it were current -- CALCULATION_SPEC's
// own numbers could differ in a way this older build has no way to know
// about.
import type { EstimateRevision } from './entities';

/**
 * Every engine version this build knows is SAFE to recalculate a live
 * draft against. Extending this list is a deliberate, audited decision
 * made when the engine's own formulas change -- never automatic. Today
 * there has only ever been one shipped version, so the list has one
 * entry; a future version bump adds a new entry only after confirming
 * the old formulas' outputs are compatible (or the migration is handled
 * explicitly, not through this safelist).
 */
export const RECOGNIZED_ENGINE_VERSIONS: readonly string[] = ['2.1.0'];

export function isRecognizedEngineVersion(version: string): boolean {
  return RECOGNIZED_ENGINE_VERSIONS.includes(version);
}

/**
 * Used ONLY to gate LIVE recalculation of a draft (assembleProjectEstimate).
 * Frozen/issued data is never subject to this check -- see
 * readFrozenCalculatedOutputs and buildCustomerDocument, neither of which
 * calls this function, by design.
 */
export function isDraftEngineVersionSupported(revision: EstimateRevision): boolean {
  return isRecognizedEngineVersion(revision.activeRateSnapshot.engineVersion);
}
