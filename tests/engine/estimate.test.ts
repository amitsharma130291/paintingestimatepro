// PRO-001 + mutation checks "Pool different colors" / "Include stale inactive
// mode inputs": a project-level surface aggregator that (a) lets wall and
// ceiling in the SAME room use DIFFERENT paint variants, (b) supports
// standalone trim/door surfaces with no room at all, (c) never lets a
// disabled surface contribute, and (d) makes the whole result invalid if any
// ENABLED surface is invalid — written before src/engine/estimate.ts exists.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { aggregateProjectSurfaces, type ProjectSurface, type VariantPricing } from '../../src/engine/estimate';

function wallSurface(over: Partial<ProjectSurface> = {}): ProjectSurface {
  return {
    id: 'wall-1',
    enabled: true,
    valid: true,
    geometry: { kind: 'wall', wallOrCeilingAreaFt2: new PEP(400) },
    paintVariantId: 'paint-white',
    coats: 2,
    wasteRatio: new PEP('0.10'),
    loadedHourlyRate: new PEP(32),
    rateOrThroughput: new PEP(150),
    ...over,
  };
}

const pricing = new Map<string, VariantPricing>([
  ['paint-white', { coveragePerGal: new PEP(350), pricePerGal: new PEP(40) }],
  ['paint-blue', { coveragePerGal: new PEP(350), pricePerGal: new PEP(55) }],
]);

describe('PRO-001: independent wall vs ceiling paint variant in the same room', () => {
  it('pools wall and ceiling demand SEPARATELY when they use different variants', () => {
    const wall = wallSurface({ id: 'wall-1', paintVariantId: 'paint-white', geometry: { kind: 'wall', wallOrCeilingAreaFt2: new PEP(400) } });
    const ceiling = wallSurface({ id: 'ceiling-1', paintVariantId: 'paint-blue', geometry: { kind: 'ceiling', wallOrCeilingAreaFt2: new PEP(200) }, rateOrThroughput: new PEP(120) });

    const { valid, result } = aggregateProjectSurfaces([wall, ceiling], pricing);
    expect(valid).toBe(true);
    expect(result!.purchases).toHaveLength(2);
    const white = result!.purchases.find((p) => p.paintVariantId === 'paint-white')!;
    const blue = result!.purchases.find((p) => p.paintVariantId === 'paint-blue')!;
    // wall: 400*2*1.10/350 = 2.514... -> ceil 3 gal; ceiling: 200*2*1.10/350 = 1.257 -> ceil 2 gal
    expect(white.purchasedGal).toBe(3);
    expect(blue.purchasedGal).toBe(2);
    expect(white.cost.toString()).toBe('120'); // 3 * 40
    expect(blue.cost.toString()).toBe('110'); // 2 * 55
  });

  it('pools wall and ceiling TOGETHER when they share the same variant (never splits by surface kind)', () => {
    const wall = wallSurface({ id: 'wall-1', geometry: { kind: 'wall', wallOrCeilingAreaFt2: new PEP(400) } });
    const ceiling = wallSurface({ id: 'ceiling-1', geometry: { kind: 'ceiling', wallOrCeilingAreaFt2: new PEP(200) }, rateOrThroughput: new PEP(120) });
    const { result } = aggregateProjectSurfaces([wall, ceiling], pricing);
    expect(result!.purchases).toHaveLength(1);
    // combined raw = 400*2*1.1/350 + 200*2*1.1/350 = 2.5142857+1.2571428 = 3.77142857 -> ceil 4
    expect(result!.purchases[0].purchasedGal).toBe(4);
  });
});

describe('Standalone trim and door surfaces (no room required)', () => {
  it('computes a standalone trim surface using linear-length labor and area-based paint demand', () => {
    const trim: ProjectSurface = {
      id: 'trim-1',
      enabled: true,
      valid: true,
      geometry: { kind: 'trim', trimLengthFt: new PEP(60), developedWidthFt: new PEP('0.5') },
      paintVariantId: 'paint-white',
      coats: 2,
      wasteRatio: new PEP('0.10'),
      loadedHourlyRate: new PEP(32),
      rateOrThroughput: new PEP(40), // linear ft/hr/coat
    };
    const { valid, result } = aggregateProjectSurfaces([trim], pricing);
    expect(valid).toBe(true);
    // area = 60*0.5 = 30 ft2; raw = 30*2*1.1/350 = 0.18857 -> ceil 1 gal
    expect(result!.purchases[0].purchasedGal).toBe(1);
    // hours = 60*2/40 = 3
    expect(result!.laborHours.toString()).toBe('3');
    expect(result!.laborCost.toString()).toBe('96'); // 3 * 32
  });

  it('computes a standalone door surface using per-side-per-coat labor, independent of any room', () => {
    const door: ProjectSurface = {
      id: 'door-1',
      enabled: true,
      valid: true,
      geometry: { kind: 'door', doorCount: 3, doorWidthFt: new PEP('2.5'), doorHeightFt: new PEP('6.67'), paintedSides: 2 },
      paintVariantId: 'paint-white',
      coats: 2,
      wasteRatio: new PEP('0.10'),
      loadedHourlyRate: new PEP(32),
      rateOrThroughput: new PEP('0.75'), // hours per side per coat
    };
    const { result } = aggregateProjectSurfaces([door], pricing);
    // hours = 3*2*2*0.75 = 9
    expect(result!.laborHours.toString()).toBe('9');
    expect(result!.laborCost.toString()).toBe('288'); // 9 * 32
    // area = 3*2.5*6.67*2 = 100.05
    // raw = 100.05*2*1.1/350 = 0.628... -> ceil 1
    expect(result!.purchases[0].purchasedGal).toBe(1);
  });
});

describe('Disabled-surface independence (mutation check: "Include stale inactive mode inputs")', () => {
  it('a disabled surface contributes zero to demand, labor, and cost', () => {
    const enabledWall = wallSurface({ id: 'wall-1' });
    const disabledCeiling = wallSurface({ id: 'ceiling-1', enabled: false, geometry: { kind: 'ceiling', wallOrCeilingAreaFt2: new PEP(99999) }, valid: false });
    const { valid, result } = aggregateProjectSurfaces([enabledWall, disabledCeiling], pricing);
    expect(valid).toBe(true); // the disabled surface's invalidity never blocks the project
    expect(result!.purchases).toHaveLength(1);
    expect(result!.purchases[0].purchasedGal).toBe(3); // same as wall-only fixture above
  });
});

describe('Enabled-and-invalid propagation', () => {
  it('marks the whole project invalid when any ENABLED surface is invalid, and returns no partial result', () => {
    const good = wallSurface({ id: 'wall-1' });
    const bad = wallSurface({ id: 'wall-2', valid: false });
    const { valid, result } = aggregateProjectSurfaces([good, bad], pricing);
    expect(valid).toBe(false);
    expect(result).toBeNull();
  });
});

describe('No enabled surfaces', () => {
  it('is treated as invalid/empty, not as a zero-cost complete project', () => {
    const disabled = wallSurface({ enabled: false });
    const { valid, result } = aggregateProjectSurfaces([disabled], pricing);
    expect(valid).toBe(false);
    expect(result).toBeNull();
  });
});
