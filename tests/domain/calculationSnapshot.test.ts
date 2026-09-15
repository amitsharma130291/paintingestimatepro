// independent-review R13: freezeCalculatedOutputs/readFrozenCalculatedOutputs
// are the pure serialize/deserialize pair the issue workflow now uses to
// actually freeze a revision's calculated outputs (previously always null).
import { describe, it, expect } from 'vitest';
import { freezeCalculatedOutputs, readFrozenCalculatedOutputs } from '../../src/domain/calculationSnapshot';
import { PEP } from '../../src/engine/decimal';
import type { ProjectEstimateAssembly } from '../../src/domain/estimateAssembly';

function completeSummary(overrides: Partial<ProjectEstimateAssembly> = {}): ProjectEstimateAssembly {
  return {
    calculationState: 'complete', reasons: [], outOfSupportedRange: false, warnings: [], aggregate: null,
    materials: new PEP('100'), laborCost: new PEP('200'), directCost: new PEP('300'), overhead: new PEP('45'), jobCost: new PEP('345'),
    price: { profit: new PEP('55'), marginRatio: new PEP('0.1375'), status: 'at_target', approxPrice: new PEP('400'), minimumTargetPrice: new PEP('400.01') },
    suggestedPrice: new PEP('400'), effectivePrice: new PEP('400'),
    ...overrides,
  };
}

describe('freezeCalculatedOutputs / readFrozenCalculatedOutputs', () => {
  it('round-trips a complete summary\'s job cost exactly', () => {
    const frozen = freezeCalculatedOutputs(completeSummary(), '2.1.0');
    const result = readFrozenCalculatedOutputs(frozen);
    expect(result.status).toBe('frozen');
    if (result.status !== 'frozen') return;
    expect(result.jobCost!.toString()).toBe('345');
    expect(result.engineVersion).toBe('2.1.0');
  });

  it('ACT-010: also round-trips the frozen overhead — the actual-cost review\'s "baseline allocation" mode needs this, not just jobCost', () => {
    const frozen = freezeCalculatedOutputs(completeSummary(), '2.1.0');
    const result = readFrozenCalculatedOutputs(frozen);
    expect(result.status).toBe('frozen');
    if (result.status !== 'frozen') return;
    expect(result.overhead!.toString()).toBe('45');
  });

  it('serializes every decimal as a plain string, never a live Decimal instance (DATA_CONTRACT: decimal scalars are text at rest)', () => {
    const frozen = freezeCalculatedOutputs(completeSummary(), '2.1.0');
    expect(typeof frozen.jobCost).toBe('string');
    expect(typeof frozen.materials).toBe('string');
    expect(typeof frozen.profit).toBe('string');
    expect(typeof frozen.marginRatio).toBe('string');
  });

  it('a null jobCost (incomplete summary) freezes as null, not a fabricated zero', () => {
    const frozen = freezeCalculatedOutputs(completeSummary({ jobCost: null, price: null }), '2.1.0');
    expect(frozen.jobCost).toBeNull();
    const result = readFrozenCalculatedOutputs(frozen);
    expect(result.status).toBe('frozen');
    if (result.status === 'frozen') expect(result.jobCost).toBeNull();
  });

  it('REGRESSION: an old record with rawCalculatedOutputs still null (issued before this fix) is reported as "missing," never crashes or silently claims a frozen zero', () => {
    expect(readFrozenCalculatedOutputs(null)).toEqual({ status: 'missing' });
    expect(readFrozenCalculatedOutputs(undefined)).toEqual({ status: 'missing' });
  });

  it('a malformed/incompatible stored value (wrong schema version) is treated as missing, not guessed at', () => {
    expect(readFrozenCalculatedOutputs({ schemaVersion: 999, engineVersion: '2.1.0', jobCost: '100' })).toEqual({ status: 'missing' });
  });

  it('a corrupted jobCost string is treated as missing rather than throwing', () => {
    expect(readFrozenCalculatedOutputs({ schemaVersion: 1, engineVersion: '2.1.0', jobCost: 'not-a-number' })).toEqual({ status: 'missing' });
  });

  it('a non-object value is treated as missing', () => {
    expect(readFrozenCalculatedOutputs('garbage')).toEqual({ status: 'missing' });
    expect(readFrozenCalculatedOutputs(42)).toEqual({ status: 'missing' });
  });

  describe('V5-06: NaN/Infinity are rejected, never accepted as a trusted historical cost', () => {
    function validRecord(overrides: Record<string, unknown> = {}) {
      return {
        schemaVersion: 1, engineVersion: '2.1.0', jobCost: '345', materials: '100', laborCost: '200',
        directCost: '300', overhead: '45', effectivePrice: '400', profit: '55', marginRatio: '0.1375',
        ...overrides,
      };
    }

    it('rejects jobCost:"NaN" even though `new PEP("NaN")` does not throw', () => {
      expect(readFrozenCalculatedOutputs(validRecord({ jobCost: 'NaN' })).status).toBe('missing');
    });

    it('rejects "Infinity" and "-Infinity" for any cost field', () => {
      expect(readFrozenCalculatedOutputs(validRecord({ jobCost: 'Infinity' })).status).toBe('missing');
      expect(readFrozenCalculatedOutputs(validRecord({ directCost: '-Infinity' })).status).toBe('missing');
    });

    it('rejects a negative cost field (materials, laborCost, directCost, overhead, effectivePrice, jobCost)', () => {
      for (const field of ['jobCost', 'materials', 'laborCost', 'directCost', 'overhead', 'effectivePrice']) {
        expect(readFrozenCalculatedOutputs(validRecord({ [field]: '-1' })).status).toBe('missing');
      }
    });

    it('accepts a negative profit and a negative marginRatio — a real loss is valid, not corruption', () => {
      const result = readFrozenCalculatedOutputs(validRecord({ profit: '-55', marginRatio: '-0.1375' }));
      expect(result.status).toBe('frozen');
    });

    it('rejects NaN/Infinity even in profit/marginRatio, which otherwise allow negative values', () => {
      expect(readFrozenCalculatedOutputs(validRecord({ profit: 'NaN' })).status).toBe('missing');
      expect(readFrozenCalculatedOutputs(validRecord({ marginRatio: 'Infinity' })).status).toBe('missing');
    });

    it('rejects a non-string numeric field (a raw JS number, never a canonical decimal string)', () => {
      expect(readFrozenCalculatedOutputs(validRecord({ jobCost: 345 })).status).toBe('missing');
    });

    it('still accepts a genuinely well-formed record with an explicit zero jobCost', () => {
      expect(readFrozenCalculatedOutputs(validRecord({ jobCost: '0' })).status).toBe('frozen');
    });
  });
});
