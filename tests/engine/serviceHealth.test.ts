// HEALTH: Price Book Health per-unit model — incomplete assumptions never
// present as a fabricated low/zero cost, and a below-cost price still
// shows a real negative margin.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { computeServiceUnitCost, evaluateServiceHealth } from '../../src/engine/serviceHealth';

const d = (n: string) => new PEP(n);

const baseInput = {
  kind: 'wall' as const,
  areaPerUnit: d('1'),
  coats: 2,
  wasteRatio: d('0.1'),
  coverageFt2PerGal: d('350'),
  pricePerGal: d('42'),
  applicationHoursPerUnit: d('1').dividedBy(d('75')),
  additionalLaborHoursPerUnit: d('0'),
  loadedHourlyRate: d('32'),
  suppliesCostPerUnit: d('0'),
  directExpensePerUnit: d('0'),
  overheadRatio: d('0.15'),
};

describe('HEALTH: Price Book Health service unit model', () => {
  it('HEALTH-01: null currentSellingPrice prompts entry rather than showing a false 0%/alarming status', () => {
    const unit = computeServiceUnitCost(baseInput);
    const row = evaluateServiceHealth('wall-standard', unit, null, d('0.35'));
    expect(row.price!.status).toBe('unpriced');
    expect(row.price!.marginRatio).toBeNull();
  });

  it('HEALTH-02 (V11): a null unitCost (missing required assumption) is incomplete, not a fabricated cheap row', () => {
    const row = evaluateServiceHealth('trim-missing-width', null, d('1.25'), d('0.35'));
    expect(row.unitCost).toBeNull();
    expect(row.price).toBeNull();
  });

  it('HEALTH-03: a price below modeled cost shows a genuine negative margin, never clamped to zero', () => {
    const unit = computeServiceUnitCost(baseInput); // modeled cost ~0.7943/unit
    const row = evaluateServiceHealth('wall-underpriced', unit, d('0.50'), d('0.35'));
    expect(row.price!.status).toBe('below_cost');
    expect(row.price!.marginRatio!.isNegative()).toBe(true);
  });

  it('HEALTH-04 (forward-derived fixture, not the homepage illustration): $1.80/unit -> ~55.9% margin', () => {
    const unit = computeServiceUnitCost(baseInput);
    const row = evaluateServiceHealth('wall-1-80', unit, d('1.80'), d('0.35'));
    expect(row.unitCost!.modeledCostPerUnit.toDecimalPlaces(6).toFixed(6)).toBe('0.794267');
    expect(row.price!.status).toBe('above_target');
  });
});
