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
import { PEP } from '../../src/engine/decimal';
import type { BusinessSettings } from '../../src/domain/entities';

function settings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: now, updatedAt: now,
    ...overrides,
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

  it('INT-008/009: marks the wall surface disabled for a ceiling-only room (includeWalls:false)', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(settings(), [], [], ids, 'rev-1');
    const result = buildProjectFromInteriorHandoff({ ...fixturePayload, includeWalls: false, includeCeiling: true }, snapshot, ids);
    const wall = result.surfaces.find((s) => s.kind === 'wall')!;
    expect(wall.enabled).toBe(false);
    const ceiling = result.surfaces.find((s) => s.kind === 'ceiling')!;
    expect(ceiling.enabled).toBe(true);
  });

  it('a payload with no includeWalls field at all (pre-INT-008/009) still enables the wall surface, for backward compatibility', () => {
    const ids = sequentialIdSource();
    const snapshot = createSnapshot(settings(), [], [], ids, 'rev-1');
    const result = buildProjectFromInteriorHandoff(fixturePayload, snapshot, ids);
    expect(result.surfaces.find((s) => s.kind === 'wall')!.enabled).toBe(true);
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

  describe('V5-09: prep/cleanup hours are preserved as an additionalLabor line, or explicitly disclosed', () => {
    it('preserves entered prep hours as a named additionalLabor line, costed at the DESTINATION business rate (32/hr from settings())', () => {
      const ids = sequentialIdSource();
      const snapshot = createSnapshot(settings(), [], [], ids, 'rev-1');
      const result = buildProjectFromInteriorHandoff({ ...fixturePayload, prepHours: '3' }, snapshot, ids);
      const line = result.revision.additionalLabor.find((l) => l.hours === '3');
      expect(line).toBeTruthy();
      expect(line!.loadedHourlyRate).toBe('32'); // settings()'s loadedHourlyRate — the Pro business's own rate, never the free tool's
      expect(result.unsupportedFieldNotes.some((n) => /prep|cleanup/i.test(n.field))).toBe(false); // preserved, not disclosed as omitted
    });

    it('the transferred hours contribute real labor cost through the actual Pro assembly pipeline', () => {
      const ids = sequentialIdSource();
      const snapshot = createSnapshot(settings(), [], [], ids, 'rev-1');
      const result = buildProjectFromInteriorHandoff({ ...fixturePayload, prepHours: '3' }, snapshot, ids);
      const revisionWithVariant = { ...result.revision, activeRateSnapshot: { ...result.revision.activeRateSnapshot, paintVariants: [result.variant] } };
      const out = assembleProjectEstimate(revisionWithVariant, { priceMode: 'suggested', customPriceRaw: '' });
      expect(out.calculationState).toBe('complete');
      // additionalLaborCost = 3 hours * $32/hr = $96, on top of whatever surface production labor applies.
      expect(out.laborCost!.greaterThanOrEqualTo(new PEP('96'))).toBe(true);
    });

    it('discloses prep hours as explicitly omitted when the destination business has no configured loaded hourly rate', () => {
      const ids = sequentialIdSource();
      const snapshot = createSnapshot(settings({ loadedHourlyRate: null }), [], [], ids, 'rev-1');
      const result = buildProjectFromInteriorHandoff({ ...fixturePayload, prepHours: '3' }, snapshot, ids);
      expect(result.revision.additionalLabor).toHaveLength(0);
      expect(result.unsupportedFieldNotes.some((n) => /prep|cleanup/i.test(n.field) && /3/.test(n.note))).toBe(true);
    });

    it('a blank/zero prepHours adds no line and no disclosure note — nothing was actually entered', () => {
      const ids = sequentialIdSource();
      const snapshot = createSnapshot(settings(), [], [], ids, 'rev-1');
      const zeroResult = buildProjectFromInteriorHandoff({ ...fixturePayload, prepHours: '0' }, snapshot, ids);
      expect(zeroResult.revision.additionalLabor).toHaveLength(0);
      const blankResult = buildProjectFromInteriorHandoff({ ...fixturePayload, prepHours: undefined }, snapshot, ids);
      expect(blankResult.revision.additionalLabor).toHaveLength(0);
    });
  });
});
