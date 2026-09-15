// BACK-026: engine-version compatibility policy. See
// docs/ENGINE_VERSION_COMPATIBILITY.md for the full written decision.
// Core claim: live (draft) recalculation is gated on a recognized
// engineVersion; frozen/issued data is NEVER gated (always read-only,
// always safe to display regardless of version) -- verified here at the
// domain layer (assembleProjectEstimate refusing to recalculate,
// readFrozenCalculatedOutputs never even looking at this policy).
import { describe, it, expect } from 'vitest';
import { isRecognizedEngineVersion, isDraftEngineVersionSupported, RECOGNIZED_ENGINE_VERSIONS } from '../../src/domain/engineCompatibility';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { readFrozenCalculatedOutputs, freezeCalculatedOutputs } from '../../src/domain/calculationSnapshot';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision } from '../../src/domain/project';
import { ENGINE_VERSION } from '../../src/domain/entities';
import type { BusinessSettings, PaintVariant, Surface, EstimateRevision } from '../../src/domain/entities';

const NOW = '2026-01-01T00:00:00.000Z';
function settings(): BusinessSettings {
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
  };
}
function variant(): PaintVariant {
  return { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW };
}
function wall(): Surface {
  return { id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual', areaFt2: '100', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null };
}
function baseRevision(): EstimateRevision {
  const ids = sequentialIdSource();
  const snap = createSnapshot(settings(), [variant()], [], ids, 'rev-1');
  return { ...createDraftRevision('project-1', snap, ids), surfaces: [wall()] };
}

describe('isRecognizedEngineVersion / RECOGNIZED_ENGINE_VERSIONS', () => {
  it('the current ENGINE_VERSION is always in the recognized list -- a build must always trust its own version', () => {
    expect(RECOGNIZED_ENGINE_VERSIONS).toContain(ENGINE_VERSION);
  });

  it('an unrecognized/future version string is rejected', () => {
    expect(isRecognizedEngineVersion('99.0.0')).toBe(false);
    expect(isRecognizedEngineVersion('not-a-version')).toBe(false);
    expect(isRecognizedEngineVersion('')).toBe(false);
  });
});

describe('BACK-026: live draft recalculation refuses an unrecognized engine version, never silently using today\'s formulas', () => {
  it('a normal draft (current engine version) calculates fine', () => {
    const revision = baseRevision();
    expect(isDraftEngineVersionSupported(revision)).toBe(true);
    const result = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(result.calculationState).toBe('complete');
  });

  it('a draft whose snapshot declares an unrecognized engine version is refused, with a clear explanation and recovery instruction, never silently recalculated', () => {
    const revision = baseRevision();
    const withFutureVersion: EstimateRevision = { ...revision, activeRateSnapshot: { ...revision.activeRateSnapshot, engineVersion: '99.0.0' } };
    expect(isDraftEngineVersionSupported(withFutureVersion)).toBe(false);
    const result = assembleProjectEstimate(withFutureVersion, { priceMode: 'suggested', customPriceRaw: '' });
    expect(result.calculationState).toBe('invalid');
    expect(result.reasons.join(' ')).toMatch(/99\.0\.0/);
    expect(result.reasons.join(' ')).toMatch(/not recognize|does not recognize/i);
    // Never a partial/silent result -- no numeric outputs leak through.
    expect(result.materials).toBeNull();
    expect(result.jobCost).toBeNull();
  });

  it('never crashes -- an unrecognized version produces a structured invalid result, not an exception', () => {
    const revision = baseRevision();
    const corrupted: EstimateRevision = { ...revision, activeRateSnapshot: { ...revision.activeRateSnapshot, engineVersion: 'garbage' } };
    expect(() => assembleProjectEstimate(corrupted, { priceMode: 'suggested', customPriceRaw: '' })).not.toThrow();
  });
});

describe('BACK-026: frozen/issued data is NEVER gated by this policy -- it is always read-only regardless of version', () => {
  it('readFrozenCalculatedOutputs happily reads back a frozen record from an unrecognized/future engine version -- it is never recalculated, so the tag is purely informational', () => {
    const revision = baseRevision();
    const summary = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    const frozen = freezeCalculatedOutputs(summary, '99.0.0'); // as if issued by some future build
    const readBack = readFrozenCalculatedOutputs(frozen);
    expect(readBack.status).toBe('frozen');
    if (readBack.status === 'frozen') {
      expect(readBack.engineVersion).toBe('99.0.0'); // carried through untouched, never rejected or rewritten
      expect(readBack.jobCost).not.toBeNull(); // the frozen number itself is still trusted and displayed
    }
  });
});
