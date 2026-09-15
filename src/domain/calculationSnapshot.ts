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
  | { status: 'frozen'; jobCost: Dec | null; engineVersion: string }
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
export function readFrozenCalculatedOutputs(raw: unknown): ReadFrozenOutputsResult {
  if (raw === null || raw === undefined || typeof raw !== 'object') return { status: 'missing' };
  const obj = raw as Partial<FrozenCalculatedOutputs>;
  if (obj.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return { status: 'missing' };
  if (typeof obj.engineVersion !== 'string') return { status: 'missing' };
  let jobCost: Dec | null = null;
  if (typeof obj.jobCost === 'string') {
    try {
      jobCost = new PEP(obj.jobCost);
    } catch {
      return { status: 'missing' };
    }
  }
  return { status: 'frozen', jobCost, engineVersion: obj.engineVersion };
}
