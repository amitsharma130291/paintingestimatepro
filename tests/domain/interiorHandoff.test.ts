// UX-013: free interior calculator -> Pro handoff. Tests the pure
// conversion only (buildProjectFromInteriorHandoff); the sessionStorage
// read/write and the "purchase not silently granted" browser-level
// behavior are covered by manual browser verification (see BUG_FIX_LOG.md)
// since they depend on ProGate's real entitlement check, which this
// environment cannot exercise against a real Dodo account.
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { buildProjectFromInteriorHandoff, type InteriorHandoffPayload } from '../../src/domain/interiorHandoff';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import type { BusinessSettings } from '../../src/domain/entities';

function settings(): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: now, updatedAt: now,
  };
}

const fixturePayload: InteriorHandoffPayload = {
  lengthFt: '20', widthFt: '16', heightFt: '9', includeCeiling: false, deductOpenings: true,
  doorCount: '2', windowCount: '3', coats: '2', coverageFt2PerGal: '350', pricePerGal: '42', wasteRatioPercent: '10',
};

describe('buildProjectFromInteriorHandoff', () => {
  it('carries room dimensions, opening counts, and paint price/coverage over exactly', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(settings(), [], [], ids, 'rev-1');
    const result = buildProjectFromInteriorHandoff(fixturePayload, snapshot, ids);

    expect(result.room.lengthFt).toBe('20');
    expect(result.room.widthFt).toBe('16');
    expect(result.room.heightFt).toBe('9');
    expect(result.room.quick.doorCount).toBe(2);
    expect(result.room.quick.windowCount).toBe(3);
    expect(result.variant.pricePerGal).toBe('42');
    expect(result.variant.coverageFt2PerGal).toBe('350');
    expect(result.surfaces).toHaveLength(1); // no ceiling in this fixture
    expect(result.surfaces[0].kind).toBe('wall');
    expect(result.surfaces[0].coats).toBe(2);
  });

  it('adds a ceiling surface when the free tool had it enabled', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(settings(), [], [], ids, 'rev-1');
    const result = buildProjectFromInteriorHandoff({ ...fixturePayload, includeCeiling: true }, snapshot, ids);
    expect(result.surfaces).toHaveLength(2);
    expect(result.surfaces.map((s) => s.kind).sort()).toEqual(['ceiling', 'wall']);
    expect(result.room.surfaceIds).toHaveLength(2);
  });

  it('explicitly lists the labor rate as an unsupported/not-transferred field, never silently dropped', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(settings(), [], [], ids, 'rev-1');
    const result = buildProjectFromInteriorHandoff(fixturePayload, snapshot, ids);
    expect(result.unsupportedFieldNotes.length).toBeGreaterThan(0);
    expect(result.unsupportedFieldNotes.some((n) => /labor/i.test(n.field))).toBe(true);
  });

  it('the resulting revision computes a COMPLETE, correct estimate through the real Pro assembly pipeline', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(settings(), [], [], ids, 'rev-1');
    const result = buildProjectFromInteriorHandoff(fixturePayload, snapshot, ids);
    // The new variant must be added to the revision's own snapshot for
    // resolveSurface() to find it (mirrors what ProApp does when it
    // actually creates the project — this proves the built revision is
    // genuinely usable, not just structurally shaped right).
    const revisionWithVariant = { ...result.revision, activeRateSnapshot: { ...result.revision.activeRateSnapshot, paintVariants: [result.variant] } };
    const out = assembleProjectEstimate(revisionWithVariant, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('complete');
    // gross wall = 2*(20+16)*9 = 648; deduction 2*20+3*15=85; net=563;
    // raw = 563*2*1.1/350 = 3.5388... -> ceil 4 gal * $42 = $168 (matches the documented fixture)
    expect(out.aggregate!.purchases[0].purchasedGal).toBe(4);
    expect(out.aggregate!.purchases[0].cost.toString()).toBe('168');
  });

  it('never mutates the input payload (pure function)', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(settings(), [], [], ids, 'rev-1');
    const payloadCopy = { ...fixturePayload };
    buildProjectFromInteriorHandoff(fixturePayload, snapshot, ids);
    expect(fixturePayload).toEqual(payloadCopy);
  });
});
