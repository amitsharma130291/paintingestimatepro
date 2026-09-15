// independent-review R13: issuing an estimate froze its customer document
// but NOT its calculated cost/price outputs — rawCalculatedOutputs was
// only ever initialized to null and never written anywhere, so the
// actual-cost comparison always fell back to a LIVE recomputation against
// whatever the current engine happens to produce today. DATA_CONTRACT.md
// requires "inputs, rates, outputs, and customer document" all frozen on
// issue — this is the versioned, serializable snapshot of "outputs" that
// was missing. Decimal scalars are stored as canonical strings, never a
// live Decimal instance, per DATA_CONTRACT.md's own rule for data at rest.
import { PEP, type Dec } from '../engine/decimal';
import type { ProjectEstimateAssembly } from './estimateAssembly';

const SNAPSHOT_SCHEMA_VERSION = 1;

export interface FrozenCalculatedOutputs {
  // Stored inside EstimateRevision.rawCalculatedOutputs, typed as
  // Record<string, unknown> — the index signature keeps that assignment
  // structurally valid while every field below stays concretely typed.
  [key: string]: unknown;
  schemaVersion: number;
  engineVersion: string;
  jobCost: string | null;
  materials: string | null;
  laborCost: string | null;
  directCost: string | null;
  overhead: string | null;
  effectivePrice: string | null;
  profit: string | null;
  marginRatio: string | null;
}

/** Called once, at the moment of issue — never re-derived afterward. */
export function freezeCalculatedOutputs(summary: ProjectEstimateAssembly, engineVersion: string): FrozenCalculatedOutputs {
  const toStr = (d: Dec | null | undefined) => d?.toString() ?? null;
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    engineVersion,
    jobCost: toStr(summary.jobCost),
    materials: toStr(summary.materials),
    laborCost: toStr(summary.laborCost),
    directCost: toStr(summary.directCost),
    overhead: toStr(summary.overhead),
    effectivePrice: toStr(summary.effectivePrice),
    profit: toStr(summary.price?.profit),
    marginRatio: toStr(summary.price?.marginRatio),
  };
}

export type ReadFrozenOutputsResult =
  | { status: 'frozen'; jobCost: Dec | null; overhead: Dec | null; engineVersion: string }
  | { status: 'missing' }; // an old record issued before this snapshot existed, or a malformed one — never silently treated as "frozen at zero"

/**
 * Reads back a stored `rawCalculatedOutputs` value defensively — an old
 * issued revision from before this snapshot existed has `null` here, and
 * that is a real, named "missing" compatibility case the caller must
 * handle explicitly (DATA_CONTRACT: never silently pass off a fresh
 * recomputation as historical evidence, but also never crash on an old
 * record). A version this build doesn't recognize is ALSO reported as
 * missing rather than guessed at.
 */
// V5-06: `new PEP('NaN')` / `new PEP('Infinity')` do NOT throw — decimal.js
// happily constructs a non-finite Decimal from that text, so the old
// try/catch-only guard let a corrupted or maliciously-imported "NaN"/
// "Infinity" string sail through as a trusted historical cost. A cost/
// price/labor/materials/overhead/effective-price field must be a finite,
// non-negative decimal; profit and marginRatio may legitimately be
// negative (a real loss) but must still be finite.
function parseFrozenScalar(raw: unknown, opts: { allowNegative: boolean }): { ok: true; value: Dec | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };
  let value: Dec;
  try {
    value = new PEP(raw);
  } catch {
    return { ok: false };
  }
  if (!value.isFinite()) return { ok: false };
  if (!opts.allowNegative && value.isNegative()) return { ok: false };
  return { ok: true, value };
}

export function readFrozenCalculatedOutputs(raw: unknown): ReadFrozenOutputsResult {
  if (raw === null || raw === undefined || typeof raw !== 'object') return { status: 'missing' };
  const obj = raw as Partial<FrozenCalculatedOutputs>;
  if (obj.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return { status: 'missing' };
  if (typeof obj.engineVersion !== 'string') return { status: 'missing' };

  const jobCost = parseFrozenScalar(obj.jobCost, { allowNegative: false });
  const materials = parseFrozenScalar(obj.materials, { allowNegative: false });
  const laborCost = parseFrozenScalar(obj.laborCost, { allowNegative: false });
  const directCost = parseFrozenScalar(obj.directCost, { allowNegative: false });
  const overhead = parseFrozenScalar(obj.overhead, { allowNegative: false });
  const effectivePrice = parseFrozenScalar(obj.effectivePrice, { allowNegative: false });
  const profit = parseFrozenScalar(obj.profit, { allowNegative: true }); // a real loss is a valid negative profit
  const marginRatio = parseFrozenScalar(obj.marginRatio, { allowNegative: true }); // a real loss is a valid negative margin
  // Every field must parse cleanly — a corrupted materials/laborCost/profit
  // string is just as untrustworthy as a corrupted jobCost, even though
  // only jobCost/overhead are returned to today's callers.
  if (!jobCost.ok || !materials.ok || !laborCost.ok || !directCost.ok || !overhead.ok || !effectivePrice.ok || !profit.ok || !marginRatio.ok) {
    return { status: 'missing' };
  }

  return { status: 'frozen', jobCost: jobCost.value, overhead: overhead.value, engineVersion: obj.engineVersion };
}
