// Boundary matrix (BOUND-012..061, CALCULATION_SPEC.md §1 "Engineering
// bounds"): each of these fields previously had NO upper-bound enforcement
// at all (only a "must parse as a decimal" / "must be a positive divisor"
// check) -- a value ten orders of magnitude past the documented ceiling
// was silently accepted. doorCount (BOUND-030..034) is covered separately
// in estimateAssembly.test.ts's "V6-04" block and is NOT repeated here.
import { describe, it, expect } from 'vitest';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision } from '../../src/domain/project';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import type { BusinessSettings, PaintVariant, Room, Surface, EstimateRevision } from '../../src/domain/entities';

const NOW = '2026-01-01T00:00:00.000Z';
const priceOptions = { priceMode: 'suggested' as const, customPriceRaw: '' };

function settings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}
function variant(): PaintVariant {
  return { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW };
}
function baseRevision(settingsOverrides: Partial<BusinessSettings> = {}): EstimateRevision {
  const ids = sequentialIdSource();
  const snap = createSnapshot(settings(settingsOverrides), [variant()], [], ids, 'rev-1');
  return createDraftRevision('project-1', snap, ids);
}
function manualWall(overrides: Partial<Surface> = {}): Surface {
  return {
    id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual', areaFt2: '100', trimLengthFt: null,
    developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1',
    coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null, ...overrides,
  };
}
function trimSurface(overrides: Partial<Surface> = {}): Surface {
  return {
    id: 'trim-1', roomId: null, kind: 'trim', enabled: true, measurementMode: 'manual', areaFt2: null, trimLengthFt: '40',
    developedWidthFt: '0.5', doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1',
    coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null, ...overrides,
  };
}
function roomDerivedRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1', name: 'Bedroom', lengthFt: '10', widthFt: '10', heightFt: '8', deductionEnabled: false, openingMode: 'quick',
    quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' }, openings: [], surfaceIds: ['wall-1'], ...overrides,
  };
}
function roomDerivedWall(overrides: Partial<Surface> = {}): Surface {
  return { ...manualWall({ roomId: 'room-1', measurementMode: 'roomDerived', areaFt2: null }), ...overrides };
}

function assemble(revision: EstimateRevision) {
  return assembleProjectEstimate(revision, priceOptions);
}

describe('BOUND-012/013: overheadRatio is [0,1] (0 and 1 already accepted; only the ceiling was unchecked)', () => {
  it.each([
    ['at the ceiling (1)', '1', 'complete'],
    ['just above the ceiling (1.001)', '1.001', 'invalid'],
    ['just below the floor (-0.001)', '-0.001', 'invalid'],
  ] as const)('overheadRatio=%s -> %s', (_label, value, expected) => {
    const revision = { ...baseRevision({ overheadRatio: value }), surfaces: [manualWall()] };
    expect(assemble(revision).calculationState).toBe(expected);
  });
});

describe('BOUND-014..017: wasteRatio is [0,1]', () => {
  it.each([
    ['zero', '0', 'complete'],
    ['one', '1', 'complete'],
    ['just below the floor (-0.001)', '-0.001', 'invalid'],
    ['just above the ceiling (1.001)', '1.001', 'invalid'],
  ] as const)('surface wasteRatio=%s -> %s', (_label, value, expected) => {
    const revision = { ...baseRevision(), surfaces: [manualWall({ wasteRatio: value })] };
    expect(assemble(revision).calculationState).toBe(expected);
  });
});

describe('BOUND-018..021: roomDimensionFt is >0 and <=100,000 ft', () => {
  it.each([
    ['just above zero (0.001)', '0.001', 'complete'],
    ['at the ceiling (100000)', '100000', 'complete'],
    ['zero', '0', 'invalid'],
    ['just above the ceiling (100000.001)', '100000.001', 'invalid'],
  ] as const)('room lengthFt=%s -> %s', (_label, value, expected) => {
    const revision = { ...baseRevision(), rooms: [roomDerivedRoom({ lengthFt: value })], surfaces: [roomDerivedWall()] };
    expect(assemble(revision).calculationState).toBe(expected);
  });
});

describe('BOUND-022..025: manualAreaFt2 is >0 and <=1,000,000,000 ft²', () => {
  // AGG-003 (DECISIONS.md #9) added an aggregate materials-cost ceiling on
  // top of this pre-existing field-level area ceiling -- at the area field's
  // OWN ceiling with a normal catalog price, the resulting materials cost
  // now genuinely exceeds that separate aggregate cap (correctly; that is
  // exactly the "even when individual rows pass limits" scenario AGG-003
  // exists to catch). An essentially-free catalog price isolates the FIELD
  // boundary this describe block is actually about from the aggregate one.
  const ids = sequentialIdSource();
  const cheapSnap = createSnapshot(settings(), [{ ...variant(), pricePerGal: '0.0001' }], [], ids, 'rev-1');
  function cheapRevision(): EstimateRevision {
    return createDraftRevision('project-1', cheapSnap, ids);
  }
  it.each([
    ['just above zero (0.001)', '0.001', 'complete'],
    ['at the ceiling (1000000000)', '1000000000', 'complete'],
    ['zero', '0', 'invalid'],
    ['just above the ceiling (1000000000.001)', '1000000000.001', 'invalid'],
  ] as const)('surface areaFt2=%s -> %s', (_label, value, expected) => {
    // throughput=MAX_RATE (in addition to the near-free paint price) also
    // keeps total labor hours under AGG-002's separate aggregate-hours
    // ceiling at the area field's own ceiling, isolating just the area
    // field boundary this describe block is about.
    const revision = { ...cheapRevision(), surfaces: [manualWall({ areaFt2: value, throughput: '1000000' })] };
    expect(assemble(revision).calculationState).toBe(expected);
  });
});

describe('BOUND-026..029: trimLengthFt is [0,1,000,000] ft (0 IS a valid value)', () => {
  it.each([
    ['zero', '0', 'complete'],
    ['at the ceiling (1000000)', '1000000', 'complete'],
    ['just below the floor (-0.001)', '-0.001', 'invalid'],
    ['just above the ceiling (1000000.001)', '1000000.001', 'invalid'],
  ] as const)('trimLengthFt=%s -> %s', (_label, value, expected) => {
    const revision = { ...baseRevision(), surfaces: [trimSurface({ trimLengthFt: value })] };
    expect(assemble(revision).calculationState).toBe(expected);
  });
});

describe('BOUND-035..038: additionalLabor hours is [0,1,000,000]', () => {
  it.each([
    ['zero', '0', 'complete'],
    ['at the ceiling (1000000)', '1000000', 'complete'],
    ['just below the floor (-0.001)', '-0.001', 'invalid'],
    ['just above the ceiling (1000000.001)', '1000000.001', 'invalid'],
  ] as const)('hours=%s -> %s', (_label, value, expected) => {
    const revision = { ...baseRevision(), surfaces: [manualWall()], additionalLabor: [{ id: 'l1', description: 'Prep', hours: value, loadedHourlyRate: '32' }] };
    expect(assemble(revision).calculationState).toBe(expected);
  });
});

describe('BOUND-039..042: a money amount is [0,1,000,000,000] (probed via otherExpenses.amount)', () => {
  // AGG-003 (DECISIONS.md #9): at this field's OWN ceiling, even
  // manualWall()'s small default cost pushes the AGGREGATE direct cost
  // fractionally past the separate aggregate cap (correctly). A zero-length
  // trim surface (a valid, zero-cost surface -- see BOUND-026) isolates the
  // FIELD boundary this describe block is actually about.
  const zeroCostSurface = () => trimSurface({ trimLengthFt: '0' });
  it.each([
    ['zero', '0', 'complete'],
    ['at the ceiling (1000000000)', '1000000000', 'complete'],
    ['just below the floor (-0.01)', '-0.01', 'invalid'],
    ['just above the ceiling (1000000000.01)', '1000000000.01', 'invalid'],
  ] as const)('otherExpenses amount=%s -> %s', (_label, value, expected) => {
    // overheadRatio=0 keeps job cost (direct cost + overhead) from
    // exceeding AGG-003's aggregate cost ceiling once overhead is added on
    // top of an otherExpenses value at its own field ceiling; targetMarginRatio=0
    // additionally keeps the SUGGESTED price's own pre-existing
    // MAX_REQUIRED_PRICE ceiling (jobCost/(1-target)) from tripping at a
    // jobCost already sitting exactly at $1,000,000,000 -- both isolate
    // just the otherExpenses field boundary this describe block is about.
    const revision = { ...baseRevision({ overheadRatio: '0', targetMarginRatio: '0' }), surfaces: [zeroCostSurface()], otherExpenses: [{ id: 'e1', description: 'Travel', amount: value }] };
    expect(assemble(revision).calculationState).toBe(expected);
  });

  it('the same ceiling applies to an other-material unit cost', () => {
    const revision = { ...baseRevision(), surfaces: [manualWall()], otherMaterialLines: [{ id: 'm1', description: 'Caulk', sourceMaterialId: null, unit: 'tube', quantity: '1', unitCost: '1000000000.01' }] };
    expect(assemble(revision).calculationState).toBe('invalid');
  });

  it('the same ceiling applies to a flat supplies allowance amount', () => {
    const revision = { ...baseRevision(), surfaces: [manualWall()], suppliesAllowance: { mode: 'flat' as const, amount: '1000000000.01', ratio: '0' } };
    expect(assemble(revision).calculationState).toBe('invalid');
  });
});

describe('BOUND-043..046: throughput/rate fields are a positive divisor AND <=1,000,000', () => {
  it.each([
    ['just above zero (0.001)', '0.001', 'complete'],
    ['at the ceiling (1000000)', '1000000', 'complete'],
    ['zero', '0', 'invalid'],
    ['just above the ceiling (1000000.001)', '1000000.001', 'invalid'],
  ] as const)('surface throughput=%s -> %s', (_label, value, expected) => {
    const revision = { ...baseRevision(), surfaces: [manualWall({ throughput: value })] };
    expect(assemble(revision).calculationState).toBe(expected);
  });

  it('the same ceiling applies to a surface loadedHourlyRate override', () => {
    const revision = { ...baseRevision(), surfaces: [manualWall({ loadedHourlyRate: '1000000.001' })] };
    expect(assemble(revision).calculationState).toBe('invalid');
  });
});

describe('BOUND-047..051: at most 500 rooms per project', () => {
  it('accepts exactly 500 rooms', () => {
    const rooms = Array.from({ length: 500 }, (_, i) => roomDerivedRoom({ id: `room-${i}`, surfaceIds: [] }));
    const revision = { ...baseRevision(), rooms, surfaces: [manualWall()] };
    expect(assemble(revision).calculationState).toBe('complete');
  });
  it('rejects 501 rooms', () => {
    const rooms = Array.from({ length: 501 }, (_, i) => roomDerivedRoom({ id: `room-${i}`, surfaceIds: [] }));
    const revision = { ...baseRevision(), rooms, surfaces: [manualWall()] };
    expect(assemble(revision).calculationState).toBe('invalid');
  });
});

describe('BOUND-052..056: at most 2,000 surfaces per project', () => {
  it('accepts exactly 2000 surfaces', () => {
    const surfaces = Array.from({ length: 2000 }, (_, i) => manualWall({ id: `wall-${i}`, enabled: i === 0 }));
    const revision = { ...baseRevision(), surfaces };
    expect(assemble(revision).calculationState).toBe('complete');
  });
  it('rejects 2001 surfaces', () => {
    const surfaces = Array.from({ length: 2001 }, (_, i) => manualWall({ id: `wall-${i}`, enabled: i === 0 }));
    const revision = { ...baseRevision(), surfaces };
    expect(assemble(revision).calculationState).toBe('invalid');
  });
});

describe('BOUND-057..061: at most 2,000 combined additional-cost ("document") lines per project', () => {
  it('accepts exactly 2000 combined lines', () => {
    const otherExpenses = Array.from({ length: 2000 }, (_, i) => ({ id: `e${i}`, description: 'Line', amount: '1' }));
    const revision = { ...baseRevision(), surfaces: [manualWall()], otherExpenses };
    expect(assemble(revision).calculationState).toBe('complete');
  });
  it('rejects 2001 combined lines', () => {
    const otherExpenses = Array.from({ length: 2001 }, (_, i) => ({ id: `e${i}`, description: 'Line', amount: '1' }));
    const revision = { ...baseRevision(), surfaces: [manualWall()], otherExpenses };
    expect(assemble(revision).calculationState).toBe('invalid');
  });
});
