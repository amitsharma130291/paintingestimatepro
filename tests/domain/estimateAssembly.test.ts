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

describe('V5-01 (related path): targetMarginRatio boundary in the Pro estimate summary itself, not just Price Book Health', () => {
  function doorRevision(targetMarginRatio: string): EstimateRevision {
    const door: Surface = {
      id: 'door-1', roomId: null, kind: 'door', enabled: true, measurementMode: 'manual',
      areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: 3, widthFt: '2.5', heightFt: '6.67', paintedSides: 2,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    const revision = baseRevision();
    return {
      ...revision,
      rooms: [],
      surfaces: [door],
      activeRateSnapshot: { ...revision.activeRateSnapshot, businessSettings: { ...revision.activeRateSnapshot.businessSettings, targetMarginRatio } },
    };
  }

  it('a saved 100% target settings value returns invalid, never throws', () => {
    let out: ReturnType<typeof assembleProjectEstimate> | undefined;
    expect(() => {
      out = assembleProjectEstimate(doorRevision('1'), { priceMode: 'suggested', customPriceRaw: '' });
    }).not.toThrow();
    expect(out!.calculationState).toBe('invalid');
  });

  it('a negative target settings value returns invalid', () => {
    const out = assembleProjectEstimate(doorRevision('-0.1'), { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('invalid');
  });

  it('a target just below 100% (0.999) is still a complete, priced result', () => {
    const out = assembleProjectEstimate(doorRevision('0.999'), { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('complete');
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

describe('Project-costing line items never crash on blank/malformed values (found while building the missing cost-entry UI)', () => {
  function doorRevision(overrides: Partial<EstimateRevision> = {}): EstimateRevision {
    const door: Surface = {
      id: 'door-1', roomId: null, kind: 'door', enabled: true, measurementMode: 'manual',
      areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: 3, widthFt: '2.5', heightFt: '6.67', paintedSides: 2,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    return { ...baseRevision(), rooms: [], surfaces: [door], ...overrides };
  }

  it('a freshly-added additionalLabor line with blank hours/rate reports incomplete, never throws', () => {
    const revision = doorRevision({ additionalLabor: [{ id: 'l1', description: 'Prep', hours: '', loadedHourlyRate: '' }] });
    let out: ReturnType<typeof assembleProjectEstimate> | undefined;
    expect(() => { out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' }); }).not.toThrow();
    expect(out!.calculationState).toBe('incomplete');
  });

  it('an additionalLabor line with malformed hours ("abc") reports invalid, never throws', () => {
    const revision = doorRevision({ additionalLabor: [{ id: 'l1', description: 'Prep', hours: 'abc', loadedHourlyRate: '32' }] });
    expect(() => assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' })).not.toThrow();
    expect(assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('invalid');
  });

  it('a complete additionalLabor line correctly adds hours*rate to laborCost', () => {
    const withLine = doorRevision({ additionalLabor: [{ id: 'l1', description: 'Prep', hours: '2', loadedHourlyRate: '32' }] });
    const withoutLine = doorRevision();
    const a = assembleProjectEstimate(withLine, { priceMode: 'suggested', customPriceRaw: '' });
    const b = assembleProjectEstimate(withoutLine, { priceMode: 'suggested', customPriceRaw: '' });
    expect(a.laborCost!.minus(b.laborCost!).toString()).toBe('64'); // 2*32
  });

  it('a freshly-added otherMaterialLines entry with blank quantity/unitCost reports incomplete, never throws', () => {
    const revision = doorRevision({ otherMaterialLines: [{ id: 'm1', description: 'Caulk', sourceMaterialId: null, unit: 'tube', quantity: '', unitCost: '' }] });
    expect(() => assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' })).not.toThrow();
    expect(assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('incomplete');
  });

  it('a complete otherMaterialLines entry correctly adds quantity*unitCost to materials', () => {
    const withLine = doorRevision({ otherMaterialLines: [{ id: 'm1', description: 'Caulk', sourceMaterialId: null, unit: 'tube', quantity: '3', unitCost: '6.50' }] });
    const withoutLine = doorRevision();
    const a = assembleProjectEstimate(withLine, { priceMode: 'suggested', customPriceRaw: '' });
    const b = assembleProjectEstimate(withoutLine, { priceMode: 'suggested', customPriceRaw: '' });
    expect(a.materials!.minus(b.materials!).toString()).toBe('19.5'); // 3*6.50
  });

  it('a freshly-added otherExpenses entry with a blank amount reports incomplete, never throws', () => {
    const revision = doorRevision({ otherExpenses: [{ id: 'e1', description: 'Travel', amount: '' }] });
    expect(() => assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' })).not.toThrow();
    expect(assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('incomplete');
  });

  it('a complete otherExpenses entry correctly adds its amount to directCost', () => {
    const withLine = doorRevision({ otherExpenses: [{ id: 'e1', description: 'Travel', amount: '40' }] });
    const withoutLine = doorRevision();
    const a = assembleProjectEstimate(withLine, { priceMode: 'suggested', customPriceRaw: '' });
    const b = assembleProjectEstimate(withoutLine, { priceMode: 'suggested', customPriceRaw: '' });
    expect(a.directCost!.minus(b.directCost!).toString()).toBe('40');
  });

  it('a blank suppliesAllowance amount/ratio reports incomplete, never throws', () => {
    const revision = doorRevision({ suppliesAllowance: { mode: 'flat', amount: '', ratio: '0' } });
    expect(() => assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' })).not.toThrow();
    expect(assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('incomplete');
  });

  it('a malformed suppliesAllowance amount reports invalid, never throws', () => {
    const revision = doorRevision({ suppliesAllowance: { mode: 'flat', amount: 'abc', ratio: '0' } });
    expect(() => assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' })).not.toThrow();
    expect(assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('invalid');
  });

  it('a valid flat supplies allowance correctly adds to materials', () => {
    const withAllowance = doorRevision({ suppliesAllowance: { mode: 'flat', amount: '25', ratio: '0' } });
    const withoutAllowance = doorRevision();
    const a = assembleProjectEstimate(withAllowance, { priceMode: 'suggested', customPriceRaw: '' });
    const b = assembleProjectEstimate(withoutAllowance, { priceMode: 'suggested', customPriceRaw: '' });
    expect(a.materials!.minus(b.materials!).toString()).toBe('25');
  });
});

describe('V6-06: supplies allowance validates/uses ONLY the active mode\'s field', () => {
  function doorRevision(overrides: Partial<EstimateRevision> = {}): EstimateRevision {
    const door: Surface = {
      id: 'door-1', roomId: null, kind: 'door', enabled: true, measurementMode: 'manual',
      areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: 3, widthFt: '2.5', heightFt: '6.67', paintedSides: 2,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    return { ...baseRevision(), rooms: [], surfaces: [door], ...overrides };
  }
  function calc(mode: 'none' | 'flat' | 'paintPercent', amount: string, ratio: string) {
    return assembleProjectEstimate(doorRevision({ suppliesAllowance: { mode, amount, ratio } }), { priceMode: 'suggested', customPriceRaw: '' });
  }
  const baseline = () => assembleProjectEstimate(doorRevision(), { priceMode: 'suggested', customPriceRaw: '' });

  describe('mode: none -- neither field is read, no matter what it contains', () => {
    it.each([
      ['both blank', '', ''],
      ['both zero', '0', '0'],
      ['a stale valid flat amount', '25', '0'],
      ['a stale valid paint-percent ratio', '0', '0.1'],
      ['a malformed amount', 'abc', '0'],
      ['a malformed ratio', '0', 'xyz'],
      ['a negative amount', '-5', '0'],
      ['a negative ratio', '0', '-0.1'],
      ['an out-of-range ratio (>1)', '0', '5'],
    ])('mode=none with %s never blocks or contributes to materials', (_label, amount, ratio) => {
      const result = calc('none', amount, ratio);
      expect(result.calculationState).toBe('complete');
      expect(result.materials!.minus(baseline().materials!).toString()).toBe('0');
    });
  });

  describe('mode: flat -- only the amount is read; the ratio is fully ignored', () => {
    it('a blank amount reports incomplete regardless of the ratio', () => {
      expect(calc('flat', '', 'xyz').calculationState).toBe('incomplete');
      expect(calc('flat', '', '-5').calculationState).toBe('incomplete');
    });
    it('a malformed amount reports invalid regardless of the ratio', () => {
      expect(calc('flat', 'abc', 'xyz').calculationState).toBe('invalid');
    });
    it('a negative amount reports invalid', () => {
      expect(calc('flat', '-10', '0').calculationState).toBe('invalid');
    });
    it('a valid amount contributes exactly itself, even with a garbage/negative/out-of-range ratio sitting inactive', () => {
      for (const staleRatio of ['', 'xyz', '-0.5', '5']) {
        const result = calc('flat', '25', staleRatio);
        expect(result.calculationState).toBe('complete');
        expect(result.materials!.minus(baseline().materials!).toString()).toBe('25');
      }
    });
  });

  describe('mode: paintPercent -- only the ratio is read; the amount is fully ignored', () => {
    it('a blank ratio reports incomplete regardless of the amount', () => {
      expect(calc('paintPercent', 'xyz', '').calculationState).toBe('incomplete');
      expect(calc('paintPercent', '-5', '').calculationState).toBe('incomplete');
    });
    it('a malformed ratio reports invalid regardless of the amount', () => {
      expect(calc('paintPercent', 'xyz', 'abc').calculationState).toBe('invalid');
    });
    it('a negative ratio reports invalid', () => {
      expect(calc('paintPercent', '0', '-0.1').calculationState).toBe('invalid');
    });
    it('a valid ratio contributes ratio*paintCost, even with a garbage/negative/blank amount sitting inactive', () => {
      const base = baseline();
      for (const staleAmount of ['', 'xyz', '-25']) {
        const result = calc('paintPercent', staleAmount, '0.1');
        expect(result.calculationState).toBe('complete');
        // paintCost contribution = 10% of the paint materials cost portion (base.materials, since no other-material lines here).
        expect(result.materials!.minus(base.materials!).toString()).toBe(base.materials!.times('0.1').toString());
      }
    });
  });

  describe('switching modes never mixes stale values from a previously-active mode', () => {
    it('flat -> none -> flat: a value entered while flat was active still applies once flat is reselected', () => {
      const flatFirst = calc('flat', '25', '0');
      const backToFlat = calc('flat', '25', '0'); // simulates re-selecting flat with its own remembered amount intact
      expect(backToFlat.materials!.toString()).toBe(flatFirst.materials!.toString());
    });
    it('paintPercent -> flat: the old ratio never leaks into the new flat total', () => {
      const result = calc('flat', '25', '0.5'); // stale ratio from a previous paintPercent session
      expect(result.materials!.minus(baseline().materials!).toString()).toBe('25'); // NOT 25 + 50% of paint cost
    });
  });
});

describe('V5-07/CORE-021: a custom selling total enforces at most two fractional digits', () => {
  function priced(customPriceRaw: string) {
    const door: Surface = {
      id: 'door-1', roomId: null, kind: 'door', enabled: true, measurementMode: 'manual',
      areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: 3, widthFt: '2.5', heightFt: '6.67', paintedSides: 2,
      paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    };
    const revision = { ...baseRevision(), rooms: [], surfaces: [door] };
    return assembleProjectEstimate(revision, { priceMode: 'custom', customPriceRaw });
  }

  it('rejects three fractional digits (12.005)', () => {
    expect(priced('12.005').calculationState).toBe('invalid');
  });

  it('accepts exactly two fractional digits (12.01)', () => {
    expect(priced('12.01').calculationState).toBe('complete');
  });

  it('accepts a whole-dollar amount with no decimal point', () => {
    expect(priced('500').calculationState).toBe('complete');
  });

  it('rejects four fractional digits (500.0001)', () => {
    expect(priced('500.0001').calculationState).toBe('invalid');
  });
});

describe('V6-04: opening counts (quick doorCount/windowCount, detailed entry count) must be nonnegative integers within the approved bound', () => {
  function roomWithDeductions(overrides: Partial<Room> = {}): Room {
    return {
      id: 'room-1', name: 'Bedroom', lengthFt: '20', widthFt: '16', heightFt: '9',
      deductionEnabled: true, openingMode: 'quick', quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' },
      openings: [], surfaceIds: ['wall-1'],
      ...overrides,
    };
  }
  const wallSurface: Surface = {
    id: 'wall-1', roomId: 'room-1', kind: 'wall', enabled: true, measurementMode: 'roomDerived',
    areaFt2: null, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
    paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
  };
  function withRoom(room: Room) {
    return { ...baseRevision(), rooms: [room], surfaces: [wallSurface] };
  }

  describe('quick mode', () => {
    it('accepts zero (no openings)', () => {
      const out = assembleProjectEstimate(withRoom(roomWithDeductions()), { priceMode: 'suggested', customPriceRaw: '' });
      expect(out.calculationState).toBe('complete');
    });
    it('accepts the maximum bound (100000)', () => {
      // A door count this large makes openings exceed gross wall area (invalid for a DIFFERENT reason: net<0), so use windowAreaEach=0 to isolate the count-bound check itself.
      const room = roomWithDeductions({ quick: { doorCount: 0, windowCount: 100000, doorAreaEach: '20', windowAreaEach: '0' } });
      const out = assembleProjectEstimate(withRoom(room), { priceMode: 'suggested', customPriceRaw: '' });
      expect(out.calculationState).toBe('complete');
    });
    it('rejects a negative door count, never adding area or producing a price', () => {
      const room = roomWithDeductions({ quick: { doorCount: -1, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' } });
      const out = assembleProjectEstimate(withRoom(room), { priceMode: 'suggested', customPriceRaw: '' });
      expect(out.calculationState).toBe('invalid');
      expect(out.effectivePrice).toBeNull();
    });
    it('rejects a negative window count', () => {
      const room = roomWithDeductions({ quick: { doorCount: 0, windowCount: -1, doorAreaEach: '20', windowAreaEach: '15' } });
      expect(assembleProjectEstimate(withRoom(room), { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('invalid');
    });
    it('rejects a fractional count reaching the model by any path other than the UI (e.g. a non-integer number)', () => {
      const room = roomWithDeductions({ quick: { doorCount: 1.9, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' } });
      expect(assembleProjectEstimate(withRoom(room), { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('invalid');
    });
    it('rejects a count above the approved maximum (100001)', () => {
      const room = roomWithDeductions({ quick: { doorCount: 100001, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' } });
      expect(assembleProjectEstimate(withRoom(room), { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('invalid');
    });
    it('ignores detailed-mode openings entirely while in quick mode (inactive-mode fields never contribute)', () => {
      const room = roomWithDeductions({ openings: [{ id: 'o1', type: 'door', widthFt: '-5', heightFt: '-5', count: -5 }] });
      const out = assembleProjectEstimate(withRoom(room), { priceMode: 'suggested', customPriceRaw: '' });
      expect(out.calculationState).toBe('complete'); // the garbage detailed entry is inactive in quick mode and must not block or corrupt the result
    });
  });

  describe('detailed mode', () => {
    function detailedRoom(count: number, overrides: Partial<Room> = {}): Room {
      return roomWithDeductions({ openingMode: 'detailed', openings: [{ id: 'o1', type: 'door', widthFt: '3', heightFt: '6.67', count }], ...overrides });
    }
    it('accepts a valid positive count', () => {
      expect(assembleProjectEstimate(withRoom(detailedRoom(1)), { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('complete');
    });
    it('accepts zero (an opening entry contributing no deduction)', () => {
      expect(assembleProjectEstimate(withRoom(detailedRoom(0)), { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('complete');
    });
    it('rejects a negative count, never adding area or producing a price', () => {
      const out = assembleProjectEstimate(withRoom(detailedRoom(-1)), { priceMode: 'suggested', customPriceRaw: '' });
      expect(out.calculationState).toBe('invalid');
      expect(out.effectivePrice).toBeNull();
    });
    it('rejects a fractional count', () => {
      expect(assembleProjectEstimate(withRoom(detailedRoom(1.5)), { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('invalid');
    });
    it('rejects a count above the approved maximum', () => {
      expect(assembleProjectEstimate(withRoom(detailedRoom(100001)), { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('invalid');
    });
    it('ignores quick-mode doorCount/windowCount entirely while in detailed mode', () => {
      const room = detailedRoom(1, { quick: { doorCount: -99, windowCount: -99, doorAreaEach: '20', windowAreaEach: '15' } });
      const out = assembleProjectEstimate(withRoom(room), { priceMode: 'suggested', customPriceRaw: '' });
      expect(out.calculationState).toBe('complete'); // garbage quick fields are inactive in detailed mode
    });
  });

  it('switching modes: a room with a garbage quick count and a valid detailed opening computes correctly once switched to detailed', () => {
    const room = roomWithDeductions({ openingMode: 'detailed', quick: { doorCount: -1, windowCount: -1, doorAreaEach: '20', windowAreaEach: '15' }, openings: [{ id: 'o1', type: 'door', widthFt: '3', heightFt: '6.67', count: 1 }] });
    expect(assembleProjectEstimate(withRoom(room), { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('complete');
  });

  it('disabling deductions ignores an invalid count entirely (deduction inactive -> counts inactive)', () => {
    const room = roomWithDeductions({ deductionEnabled: false, quick: { doorCount: -1, windowCount: -1, doorAreaEach: '20', windowAreaEach: '15' } });
    expect(assembleProjectEstimate(withRoom(room), { priceMode: 'suggested', customPriceRaw: '' }).calculationState).toBe('complete');
  });
});
