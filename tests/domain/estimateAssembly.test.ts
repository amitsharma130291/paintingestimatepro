// Domain-level assembly: turns Room/Surface entities (persisted strings) +
// a RateSnapshot into the pure engine calculation, resolving per-surface
// overrides against snapshot defaults. Exercises PRO-001 (independent
// wall/ceiling variant) and standalone trim/door surfaces end-to-end through
// the entity shapes the UI actually persists, not bare engine fixtures.
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import type { BusinessSettings, PaintVariant, Room, Surface, EstimateRevision } from '../../src/domain/entities';
import { createDraftRevision } from '../../src/domain/project';
import { PEP } from '../../src/engine/decimal';

function settings(): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35',
    defaultCoats: 2, defaultWasteRatio: '0.10', wallThroughput: '150', ceilingThroughput: '120',
    trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true,
    createdAt: now, updatedAt: now,
  };
}
function variant(id: string, price: string): PaintVariant {
  const now = '2026-01-01T00:00:00.000Z';
  return { id, name: id, color: 'white', sheen: 'eggshell', pricePerGal: price, coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: now, updatedAt: now };
}

function baseRevision(): EstimateRevision {
  const ids = sequentialIdSource();
  const snap = createSnapshot(settings(), [variant('paint-white', '40'), variant('paint-blue', '55')], [], ids, 'rev-1');
  return createDraftRevision('project-1', snap, ids);
}

describe('PRO-001 through the domain assembly: wall and ceiling in the SAME room use DIFFERENT variants', () => {
  it('produces two separate purchases, one per variant', () => {
    const room: Room = {
      id: 'room-1', name: 'Bedroom', lengthFt: '10', widthFt: '10', heightFt: '8',
      deductionEnabled: false, openingMode: 'quick', quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' },
      openings: [], surfaceIds: ['wall-1', 'ceiling-1'],
    };
    const wall: Surface = {
      id: 'wall-1', roomId: 'room-1', kind: 'wall', enabled: true, measurementMode: 'roomDerived',
      areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    const ceiling: Surface = {
      id: 'ceiling-1', roomId: 'room-1', kind: 'ceiling', enabled: true, measurementMode: 'roomDerived',
      areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
      paintVariantId: 'paint-blue', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    let revision = baseRevision();
    revision = { ...revision, rooms: [room], surfaces: [wall, ceiling] };

    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('complete');
    expect(out.aggregate!.purchases).toHaveLength(2);
    // gross wall = 2*(10+10)*8 = 320; no deductions; raw = 320*2*1.1/350 = 2.0114 -> ceil 3
    const white = out.aggregate!.purchases.find((p) => p.paintVariantId === 'paint-white')!;
    expect(white.purchasedGal).toBe(3);
    // ceiling = 10*10 = 100; raw = 100*2*1.1/350 = 0.6285 -> ceil 1
    const blue = out.aggregate!.purchases.find((p) => p.paintVariantId === 'paint-blue')!;
    expect(blue.purchasedGal).toBe(1);
  });
});

describe('Standalone surfaces with no room', () => {
  it('a project with only a standalone door surface (roomId null) is complete and priced', () => {
    const door: Surface = {
      id: 'door-1', roomId: null, kind: 'door', enabled: true, measurementMode: 'manual',
      areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: 3, widthFt: '2.5', heightFt: '6.67', paintedSides: 2,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    let revision = baseRevision();
    revision = { ...revision, rooms: [], surfaces: [door] };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('complete');
    expect(out.aggregate!.laborHours.toString()).toBe('9'); // 3*2*2*0.75
  });

  it('BOUND-026: a trim surface with trimLengthFt=0 is ACCEPTED at field validation (zero-demand geometry, not a field error)', () => {
    const trim: Surface = {
      id: 'trim-1', roomId: null, kind: 'trim', enabled: true, measurementMode: 'manual',
      areaFt2: null, trimLengthFt: '0', developedWidthFt: '0.5', doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    let revision = baseRevision();
    revision = { ...revision, rooms: [], surfaces: [trim] };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('complete'); // NOT invalid — zero length is a valid (if degenerate) field value
    expect(out.aggregate!.purchases[0].purchasedGal).toBe(0); // zero paintable area -> zero demand, but still a complete result
  });

  it('a standalone trim surface with missing developed width is incomplete, not silently zero', () => {
    const trim: Surface = {
      id: 'trim-1', roomId: null, kind: 'trim', enabled: true, measurementMode: 'manual',
      areaFt2: null, trimLengthFt: '60', developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    let revision = baseRevision();
    revision = { ...revision, rooms: [], surfaces: [trim] };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).not.toBe('complete');
    expect(out.aggregate).toBeNull();
  });
});

describe('Disabled surfaces never contribute (mutation check regression)', () => {
  it('a disabled surface with garbage geometry does not block or pollute an otherwise-valid project', () => {
    const good: Surface = {
      id: 'trim-1', roomId: null, kind: 'trim', enabled: true, measurementMode: 'manual',
      areaFt2: null, trimLengthFt: '60', developedWidthFt: '0.5', doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    const badButDisabled: Surface = {
      id: 'door-1', roomId: null, kind: 'door', enabled: false, measurementMode: 'manual',
      areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: 'garbage', heightFt: null, paintedSides: null,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    let revision = baseRevision();
    revision = { ...revision, rooms: [], surfaces: [good, badButDisabled] };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('complete');
  });
});

describe('Suggested-price mode reports real profit/margin at the effective price (regression)', () => {
  it('profit and margin are NOT null when priceMode is "suggested" — found live in the browser: proposed price showed a number but profit/margin showed "—"', () => {
    const wall: Surface = {
      id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual',
      areaFt2: '400', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    let revision = baseRevision();
    revision = { ...revision, rooms: [], surfaces: [wall] };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('complete');
    expect(out.effectivePrice).not.toBeNull();
    expect(out.price!.profit).not.toBeNull();
    expect(out.price!.marginRatio).not.toBeNull();
    expect(out.price!.status).not.toBe('unpriced');
    // The suggested price meets or exceeds the target margin (minimum-cent guarantee).
    expect(out.price!.marginRatio!.greaterThanOrEqualTo(new PEP('0.35'))).toBe(true);
  });
});

describe('A surface referencing a variant absent from the draft\'s OWN snapshot is invalid, not silently substituted', () => {
  it('found live in the browser: the UI let a user pick a variant added to the LIVE catalog after this draft was created, which the draft\'s frozen snapshot does not have yet', () => {
    const wall: Surface = {
      id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual',
      areaFt2: '400', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
      paintVariantId: 'paint-not-in-snapshot', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    let revision = baseRevision();
    revision = { ...revision, rooms: [], surfaces: [wall] };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('invalid');
    expect(out.aggregate).toBeNull();
  });
});

describe('Per-surface override vs. snapshot default fallback (DECISIONS.md #3)', () => {
  it('a surface with an explicit throughput override is not silently replaced by the settings default', () => {
    const wall: Surface = {
      id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual',
      areaFt2: '400', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: '75', hoursPerSidePerCoat: null,
    };
    let revision = baseRevision();
    revision = { ...revision, rooms: [], surfaces: [wall] };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    // hours = 400*2/75 (override), NOT /150 (settings default)
    expect(out.aggregate!.laborHours.equals(new PEP(800).dividedBy(75))).toBe(true);
    expect(out.aggregate!.laborHours.equals(new PEP(800).dividedBy(150))).toBe(false);
  });
});
