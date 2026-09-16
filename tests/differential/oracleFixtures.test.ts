import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PEP, type Dec } from '../../src/engine/decimal';
import {
  aggregateProjectSurfaces,
  type ProjectSurface,
  type SurfaceGeometryInput,
  type VariantPricing,
} from '../../src/engine/estimate';
import {
  suppliesAllowance,
  otherMaterialCost,
  materialsTotal,
  otherExpensesTotal,
  directCost,
  overheadAmount,
  estimatedJobCost,
  type SuppliesAllowanceMode,
} from '../../src/engine/cost';
import { additionalLaborCost } from '../../src/engine/labor';
import { evaluatePrice } from '../../src/engine/pricing';
import { computeServiceUnitCost, evaluateServiceHealth, type ServiceKind } from '../../src/engine/serviceHealth';
import { evaluateActualReview, type ActualCategory } from '../../src/engine/actuals';

/**
 * Differential fuzzing: every fixture here was generated AND independently
 * evaluated by docs/generate_fuzz_fixtures.py, which drives docs/
 * numerical_oracle.py -- a from-scratch Python decimal reimplementation of
 * CALCULATION_SPEC.md that never imports this engine. This file recomputes
 * each fixture's result using the REAL production TypeScript engine and
 * asserts exact agreement.
 *
 * Per this project's own test-count convention: hundreds of thousands of
 * generated comparisons run as parameterized loops inside a small number of
 * `it()` blocks (one per category), not as one `it()` per fixture -- see
 * NUMERICAL_TEST_RESULTS.csv / FINAL_NUMERICAL_VERDICT.md for the required
 * framework-level vs. internal-generated-case count distinction.
 */

const FIXTURES_DIR = process.env.ORACLE_FIXTURES_DIR
  ? process.env.ORACLE_FIXTURES_DIR
  : join(__dirname, '..', 'fixtures', 'oracle-fuzz');

function readNdjson(filename: string): any[] {
  const path = join(FIXTURES_DIR, filename);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((l) => JSON.parse(l));
}

function d(s: string | null): Dec {
  return new PEP(s as string);
}
function dOrNull(s: string | null): Dec | null {
  return s === null ? null : new PEP(s);
}

function surfaceGeometryFromJson(s: any): SurfaceGeometryInput {
  if (s.kind === 'wall' || s.kind === 'ceiling') {
    return { kind: s.kind, wallOrCeilingAreaFt2: d(s.areaFt2) };
  }
  if (s.kind === 'trim') {
    return { kind: 'trim', trimLengthFt: d(s.trimLengthFt), developedWidthFt: d(s.developedWidthFt) };
  }
  return { kind: 'door', doorCount: s.doorCount, doorWidthFt: d(s.doorWidthFt), doorHeightFt: d(s.doorHeightFt), paintedSides: s.paintedSides };
}

function projectSurfaceFromJson(s: any): ProjectSurface {
  return {
    id: s.id,
    enabled: s.enabled,
    valid: s.valid,
    geometry: surfaceGeometryFromJson(s),
    paintVariantId: s.paintVariantId,
    coats: s.coats,
    wasteRatio: d(s.wasteRatio),
    loadedHourlyRate: d(s.loadedHourlyRate),
    rateOrThroughput: d(s.rateOrThroughput),
  };
}

function variantPricingMapFromJson(vp: Record<string, { coveragePerGal: string; pricePerGal: string }>): Map<string, VariantPricing> {
  const map = new Map<string, VariantPricing>();
  for (const [id, v] of Object.entries(vp)) {
    map.set(id, { coveragePerGal: d(v.coveragePerGal), pricePerGal: d(v.pricePerGal) });
  }
  return map;
}

interface Mismatch {
  id: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

function assertField(mismatches: Mismatch[], id: string, field: string, expected: string | null, actual: Dec | null) {
  const actualStr = actual === null ? null : actual.toFixed(2);
  if (expected !== actualStr) {
    mismatches.push({ id, field, expected, actual: actualStr });
  }
}

function computeProjectResult(input: any) {
  const surfaces = input.surfaces.map(projectSurfaceFromJson);
  const variantPricing = variantPricingMapFromJson(input.variantPricing);
  const agg = aggregateProjectSurfaces(surfaces, variantPricing);
  if (!agg.valid || agg.result === null) return { valid: false as const };

  const allowance = suppliesAllowance(
    {
      mode: input.suppliesMode as SuppliesAllowanceMode,
      flatAmount: input.suppliesFlatAmount === null ? undefined : d(input.suppliesFlatAmount),
      paintPercentRatio: input.suppliesPaintPercentRatio === null ? undefined : d(input.suppliesPaintPercentRatio),
    },
    agg.result.materialsCost
  );
  const otherMat = otherMaterialCost(input.otherMaterialLines.map((l: any) => ({ quantity: d(l.quantity), unitCost: d(l.unitCost) })));
  const materials = materialsTotal(agg.result.materialsCost, otherMat, allowance);

  const addLabor = additionalLaborCost(input.additionalLaborLines.map((l: any) => ({ hours: d(l.hours), loadedHourlyRate: d(l.loadedHourlyRate) })));
  const labor = agg.result.laborCost.plus(addLabor);

  const expenses = otherExpensesTotal(input.otherExpenseAmounts.map((a: string) => ({ amount: d(a) })));

  const dc = directCost(materials, labor, expenses);
  const oh = overheadAmount(dc, d(input.overheadRatio));
  const jc = estimatedJobCost(dc, oh);

  const priceResult = evaluatePrice({ cost: jc, price: dOrNull(input.price), targetMarginRatio: d(input.targetMarginRatio) });

  return { valid: true as const, materials, labor, dc, oh, jc, priceResult };
}

describe('Differential fuzzing: production TS engine vs. independent Python oracle', () => {
  // Explicit 60s per-test timeout: DIFF-01 alone processes 100,000 fixtures
  // and has taken up to ~22s even without contention; the project's default
  // 15000ms testTimeout is fine for ordinary tests, not for this scale.
  it('DIFF-01: valid complete projects -- full assembly pipeline agrees exactly with the oracle', () => {
    const fixtures = readNdjson('valid_project.ndjson');
    const mismatches: Mismatch[] = [];
    for (const fx of fixtures) {
      const r = computeProjectResult(fx.input);
      if (fx.expected.valid !== r.valid) {
        mismatches.push({ id: fx.id, field: 'valid', expected: fx.expected.valid, actual: r.valid });
        continue;
      }
      if (!r.valid) continue;
      assertField(mismatches, fx.id, 'materialsCost', fx.expected.materialsCost, r.materials);
      assertField(mismatches, fx.id, 'laborCost', fx.expected.laborCost, r.labor);
      assertField(mismatches, fx.id, 'directCost', fx.expected.directCost, r.dc);
      assertField(mismatches, fx.id, 'overhead', fx.expected.overhead, r.oh);
      assertField(mismatches, fx.id, 'jobCost', fx.expected.jobCost, r.jc);
      assertField(mismatches, fx.id, 'profit', fx.expected.profit, r.priceResult.profit);
      if (fx.expected.status !== r.priceResult.status) {
        mismatches.push({ id: fx.id, field: 'status', expected: fx.expected.status, actual: r.priceResult.status });
      }
      assertField(mismatches, fx.id, 'approxPrice', fx.expected.approxPrice, r.priceResult.approxPrice);
      assertField(mismatches, fx.id, 'minimumTargetPrice', fx.expected.minimumTargetPrice, r.priceResult.minimumTargetPrice);
    }
    if (mismatches.length > 0) {
      console.error(`${mismatches.length} mismatches (showing up to 20):`, JSON.stringify(mismatches.slice(0, 20), null, 2));
    }
    expect({ total: fixtures.length, mismatches }).toEqual({ total: fixtures.length, mismatches: [] });
  }, 60000);

  it('DIFF-02: incomplete projects (zero enabled surfaces) are correctly reported invalid', () => {
    const fixtures = readNdjson('incomplete.ndjson');
    const mismatches: Mismatch[] = [];
    for (const fx of fixtures) {
      const surfaces: ProjectSurface[] = (fx.input.surfaces || []).map(projectSurfaceFromJson);
      const agg = aggregateProjectSurfaces(surfaces, new Map());
      if (agg.valid !== false) mismatches.push({ id: fx.id, field: 'valid', expected: false, actual: agg.valid });
    }
    expect({ total: fixtures.length, mismatches }).toEqual({ total: fixtures.length, mismatches: [] });
  }, 60000);

  it('DIFF-03: invalid projects (an enabled+invalid surface) block the WHOLE project', () => {
    const fixtures = readNdjson('invalid.ndjson');
    const mismatches: Mismatch[] = [];
    for (const fx of fixtures) {
      const r = computeProjectResult(fx.input);
      if (r.valid !== false) mismatches.push({ id: fx.id, field: 'valid', expected: false, actual: r.valid });
    }
    expect({ total: fixtures.length, mismatches }).toEqual({ total: fixtures.length, mismatches: [] });
  }, 60000);

  it('DIFF-04: boundary-adjacent paint-purchase quantities match exactly (no epsilon slop)', () => {
    const fixtures = readNdjson('boundary_adjacent.ndjson');
    const mismatches: Mismatch[] = [];
    for (const fx of fixtures) {
      const r = computeProjectResult(fx.input);
      if (fx.expected.valid !== r.valid) {
        mismatches.push({ id: fx.id, field: 'valid', expected: fx.expected.valid, actual: r.valid });
        continue;
      }
      if (!r.valid) continue;
      assertField(mismatches, fx.id, 'materialsCost', fx.expected.materialsCost, r.materials);
      assertField(mismatches, fx.id, 'jobCost', fx.expected.jobCost, r.jc);
      if (fx.expected.status !== r.priceResult.status) {
        mismatches.push({ id: fx.id, field: 'status', expected: fx.expected.status, actual: r.priceResult.status });
      }
    }
    if (mismatches.length > 0) {
      console.error(`${mismatches.length} mismatches (showing up to 20):`, JSON.stringify(mismatches.slice(0, 20), null, 2));
    }
    expect({ total: fixtures.length, mismatches }).toEqual({ total: fixtures.length, mismatches: [] });
  }, 60000);

  it('DIFF-05: loss / zero-price / unpriced states agree exactly, including signed profit and null margin', () => {
    const fixtures = readNdjson('loss_zero_unpriced.ndjson');
    const mismatches: Mismatch[] = [];
    for (const fx of fixtures) {
      const r = computeProjectResult(fx.input);
      if (fx.expected.valid !== r.valid) {
        mismatches.push({ id: fx.id, field: 'valid', expected: fx.expected.valid, actual: r.valid });
        continue;
      }
      if (!r.valid) continue;
      assertField(mismatches, fx.id, 'jobCost', fx.expected.jobCost, r.jc);
      assertField(mismatches, fx.id, 'profit', fx.expected.profit, r.priceResult.profit);
      if (fx.expected.status !== r.priceResult.status) {
        mismatches.push({ id: fx.id, field: 'status', expected: fx.expected.status, actual: r.priceResult.status });
      }
      const expectedMarginNull = fx.expected.marginRatio === null;
      const actualMarginNull = r.priceResult.marginRatio === null;
      if (expectedMarginNull !== actualMarginNull) {
        mismatches.push({ id: fx.id, field: 'marginRatio-nullness', expected: fx.expected.marginRatio, actual: r.priceResult.marginRatio?.toString() });
      }
    }
    if (mismatches.length > 0) {
      console.error(`${mismatches.length} mismatches (showing up to 20):`, JSON.stringify(mismatches.slice(0, 20), null, 2));
    }
    expect({ total: fixtures.length, mismatches }).toEqual({ total: fixtures.length, mismatches: [] });
  }, 60000);

  it('DIFF-06: Price Book Health unit costing agrees exactly (fractional, never whole-can rounded)', () => {
    const fixtures = readNdjson('price_book_health.ndjson');
    const mismatches: Mismatch[] = [];
    for (const fx of fixtures) {
      const inp = fx.input;
      const unit = computeServiceUnitCost({
        kind: inp.kind as ServiceKind,
        areaPerUnit: d(inp.areaOrLengthPerUnit),
        coats: inp.coats,
        wasteRatio: d(inp.wasteRatio),
        coverageFt2PerGal: d(inp.coverage),
        pricePerGal: d(inp.pricePerGal),
        applicationHoursPerUnit: d(inp.applicationHoursPerUnit),
        additionalLaborHoursPerUnit: d(inp.additionalLaborHoursPerUnit),
        loadedHourlyRate: d(inp.loadedHourlyRate),
        suppliesCostPerUnit: d(inp.suppliesCostPerUnit),
        directExpensePerUnit: d(inp.directExpensePerUnit),
        overheadRatio: d(inp.overheadRatio),
      });
      const row = evaluateServiceHealth('svc', unit, dOrNull(inp.currentSellingPrice), d(inp.targetMarginRatio));

      const closeEnough = (expected: string, actual: Dec, places = 8) => {
        const a = actual.toFixed(places);
        const e = new PEP(expected).toFixed(places);
        return a === e;
      };
      if (!closeEnough(fx.expected.paintConsumptionCostPerUnit, unit.paintConsumptionCostPerUnit)) {
        mismatches.push({ id: fx.id, field: 'paintConsumptionCostPerUnit', expected: fx.expected.paintConsumptionCostPerUnit, actual: unit.paintConsumptionCostPerUnit.toFixed(8) });
      }
      if (!closeEnough(fx.expected.modeledCostPerUnit, unit.modeledCostPerUnit)) {
        mismatches.push({ id: fx.id, field: 'modeledCostPerUnit', expected: fx.expected.modeledCostPerUnit, actual: unit.modeledCostPerUnit.toFixed(8) });
      }
      if (row.price && fx.expected.status !== row.price.status) {
        mismatches.push({ id: fx.id, field: 'status', expected: fx.expected.status, actual: row.price.status });
      }
    }
    if (mismatches.length > 0) {
      console.error(`${mismatches.length} mismatches (showing up to 20):`, JSON.stringify(mismatches.slice(0, 20), null, 2));
    }
    expect({ total: fixtures.length, mismatches }).toEqual({ total: fixtures.length, mismatches: [] });
  }, 60000);

  it('DIFF-07: actual-cost review state machine and variance agree exactly across confirmed/partial/out-of-range', () => {
    const fixtures = readNdjson('actual_cost.ndjson');
    const mismatches: Mismatch[] = [];
    const toCategory = (c: any): ActualCategory => ({ confirmed: c.confirmed, amount: c.amount === null ? null : d(c.amount) });
    for (const fx of fixtures) {
      const inp = fx.input;
      const r = evaluateActualReview({
        materials: toCategory(inp.materials),
        labor: toCategory(inp.labor),
        otherExpenses: toCategory(inp.otherExpenses),
        overhead: toCategory(inp.overhead),
        baselinePrice: d(inp.baselinePrice),
        baselineCost: d(inp.baselineCost),
      });
      if (fx.expected.state !== r.state) {
        mismatches.push({ id: fx.id, field: 'state', expected: fx.expected.state, actual: r.state });
        continue;
      }
      if (fx.expected.confirmedCategories !== r.confirmedCategories) {
        mismatches.push({ id: fx.id, field: 'confirmedCategories', expected: fx.expected.confirmedCategories, actual: r.confirmedCategories });
      }
      if (r.state !== 'final') continue;
      assertField(mismatches, fx.id, 'actualCost', fx.expected.actualCost, r.actualCost);
      assertField(mismatches, fx.id, 'profitAgainstOriginalQuote', fx.expected.profitAgainstOriginalQuote, r.profitAgainstOriginalQuote);
      assertField(mismatches, fx.id, 'totalVariance', fx.expected.totalVariance, r.totalVariance);
      const expectedMarginNull = fx.expected.marginRatio === null;
      const actualMarginNull = r.marginRatio === null;
      if (expectedMarginNull !== actualMarginNull) {
        mismatches.push({ id: fx.id, field: 'marginRatio-nullness', expected: fx.expected.marginRatio, actual: r.marginRatio?.toString() });
      }
    }
    if (mismatches.length > 0) {
      console.error(`${mismatches.length} mismatches (showing up to 20):`, JSON.stringify(mismatches.slice(0, 20), null, 2));
    }
    expect({ total: fixtures.length, mismatches }).toEqual({ total: fixtures.length, mismatches: [] });
  }, 60000);
});
