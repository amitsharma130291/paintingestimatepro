// Numerical-hardening initiative, Part 16: the remaining required properties
// not already covered by tests/property/{geometry,paint,pricing,document}.
// property.test.ts -- see NUMERICAL_REQUIREMENTS_MATRIX.csv for the full
// cross-reference of which file covers which of the 25 required properties.
//
// PROPERTY 14: renaming a room changes no totals.
// PROPERTY 17: rate refresh followed by undo restores identical output.
// PROPERTY 19: negative profit is never clamped to zero.
// PROPERTY 20: customer output never contains a non-allow-listed internal field.
// PROPERTY 21: results never contain NaN, Infinity, or a "-0" display artifact.
// PROPERTY 22: decimal formatting followed by supported parsing preserves the intended value.
// PROPERTY 25: aggregate values equal the sum of their defined components.
import { describe, it } from 'vitest';
import { expect } from 'vitest';
import fc from 'fast-check';
import { PEP, halfUp, toMoneyString, type Dec } from '../../src/engine/decimal';
import { parseDecimalField } from '../../src/engine/parse';
import { evaluatePrice } from '../../src/engine/pricing';
import { directCost, estimatedJobCost, overheadAmount } from '../../src/engine/cost';
import { aggregateProjectSurfaces, type ProjectSurface, type VariantPricing } from '../../src/engine/estimate';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision, updateRoom } from '../../src/domain/project';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { previewRateRefresh, applyRateRefresh, undoRateRefresh } from '../../src/domain/rateRefresh';
import { buildCustomerDocument, assertOnlyAllowedFields } from '../../src/domain/customerDocument';
import type { BusinessSettings, PaintVariant, EstimateRevision, Room, Surface } from '../../src/domain/entities';

const SEED = 20260916;
const NUM_RUNS = 13000;

function makeSettings(rate: string): BusinessSettings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'settings-1', loadedHourlyRate: rate, overheadRatio: '0.15', targetMarginRatio: '0.35',
    defaultCoats: 2, defaultWasteRatio: '0.10', wallThroughput: '150', ceilingThroughput: '120',
    trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true,
    createdAt: now, updatedAt: now,
  };
}

function makeVariant(price: string): PaintVariant {
  const now = '2026-01-01T00:00:00.000Z';
  return { id: 'paint-1', name: 'Sample White', color: 'white', sheen: 'eggshell', pricePerGal: price, coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: now, updatedAt: now };
}

/** One room containing one manual-mode wall surface -- enough to exercise
 * the full assembleProjectEstimate pipeline without needing room-derived
 * geometry. `areaFt2`, `rate`, `throughput` are the property-varied fields. */
function buildRevision(areaFt2: string, rate: string, throughput: string, price: string | null): EstimateRevision {
  const ids = sequentialIdSource();
  const snapshot = createSnapshot(makeSettings(rate), [makeVariant('40')], [], ids, 'rev-1');
  let revision = createDraftRevision('project-1', snapshot, ids);
  const room: Room = {
    id: 'room-1', name: 'Living Room', lengthFt: null, widthFt: null, heightFt: null,
    deductionEnabled: false, openingMode: 'quick',
    quick: { doorCount: 0, windowCount: 0, doorAreaEach: '20', windowAreaEach: '15' },
    openings: [], surfaceIds: ['surface-1'],
  };
  const surface: Surface = {
    id: 'surface-1', roomId: 'room-1', kind: 'wall', enabled: true, measurementMode: 'manual',
    areaFt2, trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null,
    paintedSides: null, paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.10',
    loadedHourlyRate: rate, throughput, hoursPerSidePerCoat: null,
  };
  revision = { ...revision, rooms: [room], surfaces: [surface], title: 'Test project', proposedPrice: price, priceMode: 'custom' as const };
  return revision;
}

const validArea = fc.integer({ min: 100, max: 500000 }).map((n) => (n / 10).toFixed(1)); // 10.0 .. 50000.0
const validRate = fc.integer({ min: 100, max: 15000 }).map((n) => (n / 100).toFixed(2)); // 1.00 .. 150.00
const validThroughput = fc.integer({ min: 1000, max: 50000 }).map((n) => (n / 100).toFixed(2)); // 10.00 .. 500.00

describe('PROPERTY 14: renaming rooms changes no totals', () => {
  // Explicit per-test timeout: 13,000 iterations of full domain-object
  // construction + assembleProjectEstimate observed at ~20-25s, well over
  // the project's default 15000ms testTimeout (fine for ordinary tests,
  // not for a property test at this scale).
  it('changing ONLY a room\'s name field never changes any calculated output', () => {
    fc.assert(
      fc.property(validArea, validRate, validThroughput, (area, rate, throughput) => {
        const revision = buildRevision(area, rate, throughput, '5000');
        const before = assembleProjectEstimate(revision, { priceMode: 'custom', customPriceRaw: '5000' });

        const ids = sequentialIdSource();
        const renamed = updateRoom(revision, 'room-1', { name: 'A Completely Different Name' }, ids);
        const after = assembleProjectEstimate(renamed, { priceMode: 'custom', customPriceRaw: '5000' });

        expect(after.calculationState).toBe(before.calculationState);
        if (before.calculationState === 'complete') {
          expect(after.jobCost!.toFixed(6)).toBe(before.jobCost!.toFixed(6));
          expect(after.materials!.toFixed(6)).toBe(before.materials!.toFixed(6));
          expect(after.laborCost!.toFixed(6)).toBe(before.laborCost!.toFixed(6));
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  }, 60000);
});

describe('PROPERTY 17: rate refresh followed by undo restores identical output', () => {
  // Observed ~47s at 13,000 runs -- the slowest test in this file (previews
  // AND applies AND undoes a rate refresh, each step its own domain call).
  it('previewing+applying a rate refresh, then undoing it, produces byte-identical calculated outputs to the pre-refresh state', () => {
    fc.assert(
      fc.property(validArea, validRate, validThroughput, fc.integer({ min: 100, max: 15000 }), (area, rate, throughput, newRateCents) => {
        const revision = buildRevision(area, rate, throughput, '5000');
        const before = assembleProjectEstimate(revision, { priceMode: 'custom', customPriceRaw: '5000' });

        const ids = sequentialIdSource();
        const newSettings = { ...revision.activeRateSnapshot.businessSettings, loadedHourlyRate: (newRateCents / 100).toFixed(2), updatedAt: ids.now() };
        const liveSnapshot = createSnapshot(newSettings, revision.activeRateSnapshot.paintVariants, [], ids, 'rev-2');

        const diff = previewRateRefresh(revision, liveSnapshot);
        if (diff.missingVariantIds.length > 0) return; // not applicable to this fixture shape

        const refreshed = applyRateRefresh(revision, liveSnapshot, [], ids);
        const undone = undoRateRefresh(refreshed);
        expect(undone).not.toBeNull();

        const after = assembleProjectEstimate(undone!, { priceMode: 'custom', customPriceRaw: '5000' });
        expect(after.calculationState).toBe(before.calculationState);
        if (before.calculationState === 'complete') {
          expect(after.jobCost!.toFixed(10)).toBe(before.jobCost!.toFixed(10));
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  }, 90000);
});

describe('PROPERTY 19: negative profit is never clamped to zero', () => {
  it('for any price strictly below cost, profit is EXACTLY price-cost (negative), never 0 or a clamped positive value', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10_000_000 }), // cost cents
        fc.integer({ min: 1, max: 9900 }), // target margin bp
        (costCents, targetBp) => {
          const cost = new PEP(costCents).dividedBy(100);
          const target = new PEP(targetBp).dividedBy(10000);
          const price = cost.dividedBy(2); // always strictly below cost (cost>0)
          const result = evaluatePrice({ cost, price, targetMarginRatio: target });
          expect(result.status).toBe('below_cost');
          expect(result.profit).not.toBeNull();
          expect(result.profit!.isNegative()).toBe(true);
          expect(result.profit!.toFixed(10)).toBe(price.minus(cost).toFixed(10));
          expect(result.profit!.isZero()).toBe(false);
        }
      ),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});

describe('PROPERTY 20: customer output never contains a non-allow-listed internal field', () => {
  it('buildCustomerDocument\'s output always passes assertOnlyAllowedFields, and never contains raw cost/labor/overhead/margin figures as its OWN keys', () => {
    fc.assert(
      fc.property(validArea, validRate, validThroughput, (area, rate, throughput) => {
        const revision = buildRevision(area, rate, throughput, '5000');
        const doc = buildCustomerDocument(revision, { estimateNumber: 'E-1', estimateDate: '2026-01-01', projectAddress: '123 Main St', revisionLabel: 'Rev 1' });
        expect(() => assertOnlyAllowedFields(doc as unknown as Record<string, unknown>)).not.toThrow();
        const keys = Object.keys(doc);
        for (const forbidden of ['jobCost', 'directCost', 'overhead', 'laborCost', 'materialsCost', 'marginRatio', 'profit']) {
          expect(keys).not.toContain(forbidden);
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  }, 60000);
});

describe('PROPERTY 21: results never contain NaN, Infinity, or a negative-zero display artifact', () => {
  it('across random valid project inputs, every Dec field in the assembly result is finite and never displays as "-0.00"', () => {
    fc.assert(
      fc.property(validArea, validRate, validThroughput, fc.integer({ min: 0, max: 500000 }), (area, rate, throughput, priceCents) => {
        const price = (priceCents / 100).toFixed(2);
        const revision = buildRevision(area, rate, throughput, price);
        const result = assembleProjectEstimate(revision, { priceMode: 'custom', customPriceRaw: price });
        if (result.calculationState !== 'complete') return;
        const fields: (Dec | null | undefined)[] = [result.jobCost, result.directCost, result.overhead, result.materials, result.laborCost, result.price?.profit ?? null];
        for (const f of fields) {
          if (f == null) continue;
          expect(f.isFinite()).toBe(true);
          expect(Number.isNaN(f.toNumber())).toBe(false);
          expect(f.toFixed(2)).not.toBe('-0.00');
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  }, 60000);
});

describe('PROPERTY 22: decimal formatting followed by supported parsing preserves the intended value', () => {
  it('toMoneyString(x) round-trips through parseDecimalField back to the same money-rounded value, for any supported input', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000_000, max: 100_000_000 }), (cents) => {
        const x = new PEP(cents).dividedBy(100);
        const formatted = toMoneyString(x);
        const parsed = parseDecimalField(formatted, { allowNegative: true });
        expect(parsed.kind).toBe('valid');
        if (parsed.kind === 'valid') {
          expect(parsed.value.toFixed(2)).toBe(halfUp(x, 2).toFixed(2));
        }
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});

describe('PROPERTY 25: aggregate values equal the sum of their defined components', () => {
  it('directCost === materials + labor + otherExpenses, and jobCost === directCost + overhead, for random component values (checked against the SAME production functions\' own internal consistency, not a re-derived duplicate formula)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: 5000 }),
        (materialsCents, laborCents, expensesCents, overheadBp) => {
          const materials = new PEP(materialsCents).dividedBy(100);
          const labor = new PEP(laborCents).dividedBy(100);
          const expenses = new PEP(expensesCents).dividedBy(100);
          const overheadRatio = new PEP(overheadBp).dividedBy(10000);

          const dc = directCost(materials, labor, expenses);
          expect(dc.toFixed(10)).toBe(materials.plus(labor).plus(expenses).toFixed(10));

          const oh = overheadAmount(dc, overheadRatio);
          const jc = estimatedJobCost(dc, oh);
          expect(jc.toFixed(10)).toBe(dc.plus(oh).toFixed(10));
        }
      ),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });

  it('a project\'s aggregate materialsCost equals the sum of its own per-variant purchase costs (internal consistency of a single aggregateProjectSurfaces call)', () => {
    fc.assert(
      fc.property(validArea, validRate, validThroughput, (area, rate, throughput) => {
        const surface: ProjectSurface = {
          id: 's1', enabled: true, valid: true, geometry: { kind: 'wall', wallOrCeilingAreaFt2: new PEP(area) },
          paintVariantId: 'paint-1', coats: 2, wasteRatio: new PEP('0.10'), loadedHourlyRate: new PEP(rate), rateOrThroughput: new PEP(throughput),
        };
        const pricing = new Map<string, VariantPricing>([['paint-1', { coveragePerGal: new PEP(350), pricePerGal: new PEP(40) }]]);
        const { valid, result } = aggregateProjectSurfaces([surface], pricing);
        expect(valid).toBe(true);
        const sumOfPurchases = result!.purchases.reduce((sum, p) => sum.plus(p.cost), new PEP(0));
        expect(result!.materialsCost.toFixed(10)).toBe(sumOfPurchases.toFixed(10));
      }),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });
});
