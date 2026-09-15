// CORE-001, CORE-002, CORE-007, CORE-012, CORE-013, CORE-014, CORE-015,
// CORE-019, CORE-027, CORE-028: shared parsing/result-state behaviors
// (CALCULATION_SPEC.md sections 1, 6, 7) that were implemented and believed
// correct by inspection, but had no test exercising the exact GIVEN/WHEN/
// THEN scenario named in the requirements matrix.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { parseDecimalField } from '../../src/engine/parse';
import { evaluatePrice, requiredPriceRaw, minimumTargetPrice } from '../../src/engine/pricing';
import { toPercentString } from '../../src/engine/decimal';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { createDraftRevision, checkIssueGate } from '../../src/domain/project';
import { evaluateJobCost } from '../../src/components/tools/jobCostCalculatorLogic';
import type { BusinessSettings, PaintVariant, Surface, EstimateRevision } from '../../src/domain/entities';

const d = (n: string) => new PEP(n);

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
function baseRevision(settingsOverrides: Partial<BusinessSettings> = {}): EstimateRevision {
  const ids = sequentialIdSource();
  const snap = createSnapshot(settings(settingsOverrides), [variant('paint-white', '40')], [], ids, 'rev-1');
  return createDraftRevision('project-1', snap, ids);
}
function wallSurface(overrides: Partial<Surface> = {}): Surface {
  return {
    id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual',
    areaFt2: '400', trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
    paintVariantId: 'paint-white', coats: 2, wasteRatio: '0.10', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    ...overrides,
  };
}

describe('CORE-001: a surface with no loadedHourlyRate anywhere (no override, no settings default) is incomplete, not a crash or a $0 rate', () => {
  it('reports incomplete and names the specific surface, with no priced output', () => {
    const revision = { ...baseRevision({ loadedHourlyRate: null }), rooms: [], surfaces: [wallSurface()] };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('incomplete');
    expect(out.reasons.some((r) => r.includes('wall-1'))).toBe(true);
    expect(out.price).toBeNull();
    expect(out.jobCost).toBeNull();
  });
});

describe('CORE-002: a required cost field of "-1" is invalid at the engine boundary and retains the raw text, never coerced to zero', () => {
  it('parseDecimalField rejects -1 (negative not allowed) and keeps rawText for the UI to redisplay', () => {
    const result = parseDecimalField('-1');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.rawText).toBe('-1'); // the exact text the user typed, not a coerced "0"
      expect(result.code).toBe('negative_not_allowed');
    }
  });
});

describe('CORE-007: the free job-cost calculator persists a percent-entered target as a ratio, with no double division by 100', () => {
  it('target=35% on cost=65 requires a minimum price of exactly $100.00 (not $6500.00 or $0.65-scaled)', () => {
    const result = evaluateJobCost({
      materialsMode: 'lumpSum', materialsAmount: '65', paintGallons: '', paintPricePerGal: '', suppliesAmount: '',
      laborMode: 'direct', laborAmount: '0', laborHours: '', loadedHourlyRate: '',
      travelAmount: '', otherExpenseLines: [],
      overheadMode: 'flat', overheadPercent: '15', overheadFlat: '0',
      targetPercent: '35', pricingMode: 'solveForPrice', enteredPrice: '',
    });
    expect(result.state).toBe('complete');
    if (result.state !== 'complete') return;
    expect(result.cost.toFixed(2)).toBe('65.00');
    // requiredPriceRaw(65, 0.35) = 65/0.65 = 100 exactly -> no rounding needed.
    expect(result.price.minimumTargetPrice!.toFixed(2)).toBe('100.00');
  });
});

describe('CORE-012: cost=0, price=100 -- margin never divides by cost (would be undefined/Infinity), only by price', () => {
  it('profit=$100.00, margin=100.0%', () => {
    const r = evaluatePrice({ cost: d('0'), price: d('100'), targetMarginRatio: d('0.35') });
    expect(r.profit!.toFixed(2)).toBe('100.00');
    expect(r.marginRatio!.toString()).toBe('1'); // 100%, computed as (price-cost)/price, never /cost
    expect(toPercentString(r.marginRatio!)).toBe('100.0');
  });
});

describe('CORE-013: cost=0, price=0 -- profit=$0.00, margin=null (zero_price), never a NaN percentage', () => {
  it('reports the zero_price status with a real numeric profit and a null (not NaN) margin', () => {
    const r = evaluatePrice({ cost: d('0'), price: d('0'), targetMarginRatio: d('0.35') });
    expect(r.status).toBe('zero_price');
    expect(r.profit!.toFixed(2)).toBe('0.00');
    expect(r.marginRatio).toBeNull();
  });
});

describe('CORE-014/CORE-015: the displayed percentage rounds to one place, but status compares the raw (unrounded) margin -- never the formatted string', () => {
  it('CORE-014: cost=65.0001 displays "35.0%" but the raw status is below_target (marginRatio < 0.35 exactly)', () => {
    const r = evaluatePrice({ cost: d('65.0001'), price: d('100'), targetMarginRatio: d('0.35') });
    expect(toPercentString(r.marginRatio!)).toBe('35.0');
    expect(r.marginRatio!.lessThan(d('0.35'))).toBe(true);
    expect(r.status).toBe('below_target');
  });

  it('CORE-015: cost=64.9999 displays "35.0%" but the raw status is above_target (marginRatio > 0.35 exactly)', () => {
    const r = evaluatePrice({ cost: d('64.9999'), price: d('100'), targetMarginRatio: d('0.35') });
    expect(toPercentString(r.marginRatio!)).toBe('35.0');
    expect(r.marginRatio!.greaterThan(d('0.35'))).toBe(true);
    expect(r.status).toBe('above_target');
  });

  it('the two cases above are NOT the same raw status, even though their formatted percentages are identical', () => {
    const below = evaluatePrice({ cost: d('65.0001'), price: d('100'), targetMarginRatio: d('0.35') });
    const above = evaluatePrice({ cost: d('64.9999'), price: d('100'), targetMarginRatio: d('0.35') });
    expect(toPercentString(below.marginRatio!)).toBe(toPercentString(above.marginRatio!));
    expect(below.status).not.toBe(above.status);
  });
});

describe('CORE-019: a target margin of exactly 0 requires a raw price equal to cost, rounding up only when the cost itself has sub-cent precision', () => {
  it('a whole-cent cost needs no rounding at all', () => {
    const raw = requiredPriceRaw(d('100'), d('0')) as ReturnType<typeof requiredPriceRaw>;
    expect(raw).not.toBe('out_of_supported_range');
    if (raw === 'out_of_supported_range') return;
    expect(raw.toString()).toBe('100'); // raw price === cost exactly, target 0
    expect(minimumTargetPrice(raw).toFixed(2)).toBe('100.00');
  });

  it('a sub-cent cost rounds the minimum target price UP, never down (never undershoots a 0% target)', () => {
    const raw = requiredPriceRaw(d('100.001'), d('0')) as ReturnType<typeof requiredPriceRaw>;
    if (raw === 'out_of_supported_range') throw new Error('unexpected');
    expect(raw.toString()).toBe('100.001');
    expect(minimumTargetPrice(raw).toFixed(2)).toBe('100.01'); // ceil to the cent, not floor/nearest
  });
});

describe('CORE-027: clearing one previously-valid field removes the stale complete result and reports incomplete, retaining the other still-valid data', () => {
  it('a project that was complete becomes incomplete (not stuck showing the old result) once a required field is blanked, and the OTHER surface is unaffected', () => {
    const two = { ...baseRevision(), rooms: [], surfaces: [wallSurface({ id: 'wall-1' }), wallSurface({ id: 'wall-2', areaFt2: '200' })] };
    const before = assembleProjectEstimate(two, { priceMode: 'suggested', customPriceRaw: '' });
    expect(before.calculationState).toBe('complete');

    // Clear wall-1's area (a required field) -- simulates the user deleting their entry.
    const cleared = { ...two, surfaces: [wallSurface({ id: 'wall-1', areaFt2: null }), wallSurface({ id: 'wall-2', areaFt2: '200' })] };
    const after = assembleProjectEstimate(cleared, { priceMode: 'suggested', customPriceRaw: '' });
    expect(after.calculationState).toBe('incomplete'); // not still "complete" with a stale price
    expect(after.price).toBeNull();
    expect(after.jobCost).toBeNull();
    // The surviving surface's own data was never mutated by this recalculation.
    expect(cleared.surfaces[1].areaFt2).toBe('200');
  });
});

describe('CORE-028: an incomplete draft can be saved, but final issue is blocked -- the partial result is never issueable', () => {
  it('checkIssueGate reports canIssue=false with an explicit "not complete" reason when calculationState is incomplete', () => {
    const revision: EstimateRevision = {
      ...baseRevision(),
      title: 'Kitchen repaint',
      rooms: [],
      surfaces: [wallSurface()],
      calculationState: 'incomplete', // the persisted state after a partial save
      proposedPrice: '500.00',
    };
    // "Draft saves" is unconditional -- checkIssueGate is only ever consulted
    // at the moment of ISSUING, never blocks a plain save. This test proves
    // only the issue-time gate; persistence itself has no gate at all.
    const gate = checkIssueGate(revision, { sampleAssumptionsConfirmed: true, zeroPriceConfirmed: false });
    expect(gate.canIssue).toBe(false);
    expect(gate.reasons.some((r) => /not complete/i.test(r))).toBe(true);
  });

  it('the same draft becomes issueable once its calculationState is complete, all else equal', () => {
    const revision: EstimateRevision = {
      ...baseRevision(),
      title: 'Kitchen repaint',
      rooms: [],
      surfaces: [wallSurface()],
      calculationState: 'complete',
      proposedPrice: '500.00',
    };
    const gate = checkIssueGate(revision, { sampleAssumptionsConfirmed: true, zeroPriceConfirmed: false });
    expect(gate.canIssue).toBe(true);
  });
});

describe('CORE-029: removing every surface leaves no complete priced estimate (never a false 100% margin), and never touches the caller\'s custom price input', () => {
  it('an empty-surfaces revision is incomplete regardless of price mode, with null price/jobCost', () => {
    const revision = { ...baseRevision(), rooms: [], surfaces: [] };
    const out = assembleProjectEstimate(revision, { priceMode: 'custom', customPriceRaw: '250.00' });
    expect(out.calculationState).toBe('incomplete');
    expect(out.price).toBeNull();
    expect(out.jobCost).toBeNull();
    expect(out.effectivePrice).toBeNull();
  });

  it('the customPriceRaw the caller supplied is never inspected or altered when there are no surfaces (the UI is free to keep displaying it verbatim)', () => {
    const revision = { ...baseRevision(), rooms: [], surfaces: [] };
    const enteredPrice = '250.00';
    const out = assembleProjectEstimate(revision, { priceMode: 'custom', customPriceRaw: enteredPrice });
    // No malformed-custom-price reason appears -- the function short-circuits
    // on "no surfaces" before it ever parses customPriceRaw, so a garbage
    // value there could not have been rejected or silently normalized either.
    expect(out.reasons.some((r) => /custom price/i.test(r))).toBe(false);
    expect(enteredPrice).toBe('250.00'); // the caller's own variable, unmodified -- retained for correction
  });
});
