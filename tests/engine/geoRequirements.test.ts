// GEO-005, GEO-007, GEO-008, GEO-015, GEO-016, GEO-020, GEO-021, GEO-026,
// GEO-028: exact matrix-quoted geometry/aggregation scenarios. Most of
// these formulas were already covered by tests/engine/geometry.test.ts and
// tests/engine/estimate.test.ts with DIFFERENT figures than the ones the
// requirements matrix names -- these tests use the matrix's own exact
// numbers, and drive the pooling/production-path cases (GEO-007, GEO-015,
// GEO-016, GEO-021, GEO-028) all the way through aggregateProjectSurfaces,
// not just the underlying geometry/paint primitives.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { detailedOpeningArea, grossWallArea, doorPaintableArea } from '../../src/engine/geometry';
import { purchasedGallons } from '../../src/engine/paint';
import { aggregateProjectSurfaces, type ProjectSurface } from '../../src/engine/estimate';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { createDraftRevision } from '../../src/domain/project';
import type { BusinessSettings, PaintVariant, Room, Surface } from '../../src/domain/entities';

const d = (n: string) => new PEP(n);

describe('GEO-005: a detailed window opening (3x5, count 3) deducts 45ft^2 -- count applied exactly once', () => {
  it('45 = 3*5*3, not 3*5 nor (3*5)*3*3', () => {
    const area = detailedOpeningArea([{ widthFt: d('3'), heightFt: d('5'), count: 3 }]);
    expect(area.toNumber()).toBe(45);
  });
});

describe('GEO-008: a room 12.5x10x8 has a gross wall area of exactly 360ft^2, decimal feet retained (no truncation to whole feet)', () => {
  it('(12.5+10)*2*8 = 360', () => {
    expect(grossWallArea(d('12.5'), d('10'), d('8')).toNumber()).toBe(360);
  });
});

describe('GEO-026: a standalone door (count 2, 3x7, 1 painted side) derives exactly 42ft^2, independent of a differently-counted door', () => {
  it('42 = 3*7*2*1, and a single door of the same dimensions is NOT half of this by coincidence of a shared formula bug', () => {
    const twoDoors = doorPaintableArea(2, d('3'), d('7'), 1);
    expect(twoDoors.toNumber()).toBe(42);
    const oneDoor = doorPaintableArea(1, d('3'), d('7'), 1);
    expect(twoDoors.toNumber()).toBe(oneDoor.toNumber() * 2); // scales linearly with count, not some other exponent
  });
});

describe('GEO-020: zero raw demand purchases exactly 0 gallons -- no minimum-1-gallon floor', () => {
  it('purchasedGallons(0) === 0', () => {
    expect(purchasedGallons(d('0'))).toBe(0);
  });
});

function surface(overrides: Partial<ProjectSurface> = {}): ProjectSurface {
  return {
    id: 's1', enabled: true, valid: true,
    geometry: { kind: 'wall', wallOrCeilingAreaFt2: d('100') },
    paintVariantId: 'v1', coats: 2, wasteRatio: d('0.10'), loadedHourlyRate: d('32'), rateOrThroughput: d('150'),
    ...overrides,
  };
}
const pricing = new Map([['v1', { coveragePerGal: d('100'), pricePerGal: d('40') }]]);

describe('GEO-021: coverage=350, area=350, coats=1, waste=0 through the full production aggregation path yields exactly 1 gallon -- no manufactured rounding noise', () => {
  it('one wall surface at these exact figures purchases exactly 1 gallon of the exact variant', () => {
    const s = surface({ geometry: { kind: 'wall', wallOrCeilingAreaFt2: d('350') }, coats: 1, wasteRatio: d('0') });
    const out = aggregateProjectSurfaces([s], new Map([['v1', { coveragePerGal: d('350'), pricePerGal: d('40') }]]));
    expect(out.valid).toBe(true);
    expect(out.result!.purchases).toHaveLength(1);
    expect(out.result!.purchases[0].rawGal.toString()).toBe('1'); // exact, not 0.999999... or 1.000000001
    expect(out.result!.purchases[0].purchasedGal).toBe(1);
  });
});

describe('GEO-015: two same-variant surfaces (areas 100/100, coats 1/3, coverage 100, waste 0) pool to exactly 4 gallons of raw demand, purchasing exactly 4', () => {
  it('1 (100*1/100) + 3 (100*3/100) = 4 raw, ceil(4) = 4 -- no partial-gallon rounding up', () => {
    const a = surface({ id: 'a', geometry: { kind: 'wall', wallOrCeilingAreaFt2: d('100') }, coats: 1, wasteRatio: d('0') });
    const b = surface({ id: 'b', geometry: { kind: 'wall', wallOrCeilingAreaFt2: d('100') }, coats: 3, wasteRatio: d('0') });
    const out = aggregateProjectSurfaces([a, b], pricing);
    expect(out.result!.purchases).toHaveLength(1); // pooled into ONE purchase line for the shared variant
    expect(out.result!.purchases[0].rawGal.toString()).toBe('4');
    expect(out.result!.purchases[0].purchasedGal).toBe(4);
  });
});

describe('GEO-016: two same-variant surfaces (areas 100/100, coats 1, waste 0/0.2, coverage 100) pool to 2.2 raw gallons, purchasing 3', () => {
  it('1 (100*1*1/100) + 1.2 (100*1*1.2/100) = 2.2 raw, ceil(2.2) = 3', () => {
    const a = surface({ id: 'a', geometry: { kind: 'wall', wallOrCeilingAreaFt2: d('100') }, coats: 1, wasteRatio: d('0') });
    const b = surface({ id: 'b', geometry: { kind: 'wall', wallOrCeilingAreaFt2: d('100') }, coats: 1, wasteRatio: d('0.2') });
    const out = aggregateProjectSurfaces([a, b], pricing);
    expect(out.result!.purchases[0].rawGal.toString()).toBe('2.2');
    expect(out.result!.purchases[0].purchasedGal).toBe(3);
  });
});

describe('GEO-028: two door surfaces of different sizes sum their independently derived areas and demand -- never averaged', () => {
  it('a 3x7 door and a 2x6 door (both 1 painted side, same variant) sum to exactly 21+12=33ft^2 worth of demand, not their average', () => {
    const doorA = surface({ id: 'a', geometry: { kind: 'door', doorCount: 1, doorWidthFt: d('3'), doorHeightFt: d('7'), paintedSides: 1 }, coats: 1, wasteRatio: d('0'), rateOrThroughput: d('0.75') });
    const doorB = surface({ id: 'b', geometry: { kind: 'door', doorCount: 1, doorWidthFt: d('2'), doorHeightFt: d('6'), paintedSides: 1 }, coats: 1, wasteRatio: d('0'), rateOrThroughput: d('0.75') });
    const out = aggregateProjectSurfaces([doorA, doorB], pricing);
    // area A = 3*7=21, area B=2*6=12; raw demand = (21+12)*1*1/100 = 0.33 -- summed, not (21+12)/2 averaged.
    expect(out.result!.purchases[0].rawGal.toString()).toBe('0.33');
  });
});

function settings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35',
    defaultCoats: 2, defaultWasteRatio: '0.10', wallThroughput: '150', ceilingThroughput: '120',
    trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true,
    createdAt: now, updatedAt: now,
    ...overrides,
  };
}
function variant(id: string, price: string): PaintVariant {
  const now = '2026-01-01T00:00:00.000Z';
  return { id, name: id, color: 'white', sheen: 'eggshell', pricePerGal: price, coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: now, updatedAt: now };
}

describe('GEO-007: at the full project level, openings exceeding gross wall area by exactly 0.01ft^2 blocks the whole project as invalid -- never a clamped zero-area "complete" surface', () => {
  it('a 10x10x8 room (gross=320ft^2) with a single quick door of exactly 320.01ft^2 produces an invalid project, never a clamped/zero-area complete result', () => {
    const ids = sequentialIdSource();
    const snap = createSnapshot(settings(), [variant('paint-1', '40')], [], ids, 'rev-1');
    const revision = createDraftRevision('project-1', snap, ids);
    const room: Room = {
      id: 'room-1', name: 'Room', lengthFt: '10', widthFt: '10', heightFt: '8',
      deductionEnabled: true, openingMode: 'quick',
      quick: { doorCount: 1, windowCount: 0, doorAreaEach: '320.01', windowAreaEach: '0' },
      openings: [], surfaceIds: ['wall-1'],
    };
    const wall: Surface = {
      id: 'wall-1', roomId: 'room-1', kind: 'wall', enabled: true, measurementMode: 'roomDerived',
      areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
      paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    const out = assembleProjectEstimate({ ...revision, rooms: [room], surfaces: [wall] }, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('invalid'); // never "complete" with a clamped zero area
    expect(out.aggregate).toBeNull();
    expect(out.price).toBeNull();

    // Exactly AT the boundary (openings == gross, not exceeding it) remains valid/complete -- proves this is a
    // genuine ">" boundary check, not an off-by-a-cent bug that also rejects the exact-equal case.
    const atBoundary = { ...revision, rooms: [{ ...room, quick: { ...room.quick, doorAreaEach: '320' } }], surfaces: [wall] };
    const boundaryOut = assembleProjectEstimate(atBoundary, { priceMode: 'suggested', customPriceRaw: '' });
    expect(boundaryOut.calculationState).toBe('complete');
  });
});
