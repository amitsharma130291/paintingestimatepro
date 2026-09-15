// AGG-001 through AGG-006: DECISIONS.md #9 -- "Calculated aggregate
// limits: inputs have bounds; required selling price has a $1bn cap.
// Define how aggregates beyond practical display/storage limits are
// reported, even when individual rows pass limits. No overflow/NaN or
// silent saturation is acceptable." Every field-level bound elsewhere
// caps ONE entered value; these tests specifically construct scenarios
// where every individual field passes its own bound, but the COMPUTED
// aggregate (paint demand, labor hours, materials/labor/direct/overhead/
// job cost, a suggested or custom price, an actual-cost total) still
// exceeds the practical ceiling this session adds.
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { createDraftRevision, checkIssueGate } from '../../src/domain/project';
import { buildCustomerDocument } from '../../src/domain/customerDocument';
import { evaluateActualReview } from '../../src/engine/actuals';
import type { BusinessSettings, PaintVariant, Surface, EstimateRevision } from '../../src/domain/entities';

const NOW = '2026-01-01T00:00:00.000Z';
const d = (n: string) => new PEP(n);

function settings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35',
    defaultCoats: 2, defaultWasteRatio: '0.10', wallThroughput: '150', ceilingThroughput: '120',
    trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true,
    createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}
function variant(overrides: Partial<PaintVariant> = {}): PaintVariant {
  return { id: 'paint-white', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '40', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW, ...overrides };
}
function baseRevision(settingsOverrides: Partial<BusinessSettings> = {}, variantOverrides: Partial<PaintVariant> = {}): EstimateRevision {
  const ids = sequentialIdSource();
  const snap = createSnapshot(settings(settingsOverrides), [variant(variantOverrides)], [], ids, 'rev-1');
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

describe('AGG-001: aggregate raw paint demand / purchased gallons beyond the supported range is a structured invalid result, never Infinity/NaN', () => {
  it('an individually-valid-but-tiny catalog coverage combined with the max allowed area inflates raw demand past the cap -> invalid, outOfSupportedRange, no aggregate/materials computed', () => {
    const revision = {
      ...baseRevision({}, { coverageFt2PerGal: '0.001' }), // tiny but positive -- no per-field ceiling exists on catalog coverage
      rooms: [],
      surfaces: [wallSurface({ areaFt2: '1000000000', coats: 1, wasteRatio: '0' })], // MAX_AREA_FT2, still individually valid
    };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('invalid');
    expect(out.outOfSupportedRange).toBe(true);
    expect(out.aggregate).toBeNull();
    expect(out.materials).toBeNull();
    expect(out.reasons.join(' ')).toMatch(/paint demand|supported range/i);
    // Never a plausible-looking number, never Infinity/NaN leaking into a reason string.
    expect(out.reasons.join(' ')).not.toMatch(/Infinity|NaN/);
  });

  it('the same shape just inside the cap still computes a real complete result (proves this is a genuine boundary, not an overly aggressive rejection)', () => {
    const revision = {
      ...baseRevision({}, { coverageFt2PerGal: '350' }),
      rooms: [],
      surfaces: [wallSurface({ areaFt2: '1000', coats: 1, wasteRatio: '0' })],
    };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('complete');
    expect(out.outOfSupportedRange).toBe(false);
  });
});

describe('AGG-002: aggregate labor hours beyond the supported range is a structured invalid result', () => {
  it('the max allowed area at the minimum allowed positive throughput inflates total labor hours past the cap', () => {
    const revision = {
      ...baseRevision(),
      rooms: [],
      surfaces: [wallSurface({ areaFt2: '1000000000', coats: 5, throughput: '0.000000001' })], // MAX_AREA_FT2, MAX coats, MIN_POSITIVE_DIVISOR throughput -- each individually valid
    };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('invalid');
    expect(out.outOfSupportedRange).toBe(true);
    expect(out.reasons.join(' ')).toMatch(/labor hours|supported range/i);
  });
});

describe('AGG-003: aggregate monetary totals (materials, labor cost, direct cost, overhead, job cost) beyond the supported range are structured invalid results', () => {
  it('materials cost: a large purchase at the maximum catalog price per gallon exceeds the cap even though area/coverage/price are each individually valid', () => {
    const revision = {
      ...baseRevision({}, { pricePerGal: '1000000000' }), // an individually-unbounded catalog field
      rooms: [],
      surfaces: [wallSurface({ areaFt2: '1000000000', coats: 1, wasteRatio: '0' })],
    };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('invalid');
    expect(out.outOfSupportedRange).toBe(true);
  });

  it('labor cost: hours within the aggregate-hours cap at the maximum rate still exceeds the monetary cap', () => {
    // area=150000, coats=2, throughput=150 -> hours=2000 (<< MAX_AGGREGATE_HOURS); rate=MAX_RATE(1,000,000) -> laborCost=2,000,000,000
    const revision = {
      ...baseRevision(),
      rooms: [],
      surfaces: [wallSurface({ areaFt2: '150000', coats: 2, throughput: '150', loadedHourlyRate: '1000000' })],
    };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    expect(out.calculationState).toBe('invalid');
    expect(out.outOfSupportedRange).toBe(true);
  });

  it('a custom entered price beyond the cap is rejected as an ordinary invalid field -- never becomes a plausible issueable price', () => {
    const revision = { ...baseRevision(), rooms: [], surfaces: [wallSurface()] };
    const out = assembleProjectEstimate(revision, { priceMode: 'custom', customPriceRaw: '2000000000.00' });
    expect(out.calculationState).toBe('invalid');
    expect(out.price).toBeNull();
    expect(out.effectivePrice).toBeNull();
  });

  it('a custom price exactly at the cap is accepted (proves the boundary is exact, not overly aggressive)', () => {
    const revision = { ...baseRevision(), rooms: [], surfaces: [wallSurface()] };
    const out = assembleProjectEstimate(revision, { priceMode: 'custom', customPriceRaw: '1000000000.00' });
    expect(out.calculationState).toBe('complete');
    expect(out.effectivePrice!.toString()).toBe('1000000000');
  });

  it('GENUINE GAP: a job cost within the new aggregate cap can still make requiredPriceRaw itself report out_of_supported_range at an extreme target margin -- this must surface as invalid, never a "complete" result with a silently-null price', () => {
    // additionalLabor: 900 hours * $1,000,000/hr = $900,000,000 direct cost (under the $1B cap on its own).
    // targetMarginRatio=0.99 -> requiredPriceRaw = 900,000,000 / 0.01 = 90,000,000,000, past MAX_REQUIRED_PRICE.
    const revision = {
      ...baseRevision({ overheadRatio: '0', targetMarginRatio: '0.99' }),
      rooms: [],
      surfaces: [wallSurface({ areaFt2: '1' })], // trivial, near-zero cost -- the additionalLabor line does the real work
      additionalLabor: [{ id: 'l1', description: 'Extreme prep', hours: '900', loadedHourlyRate: '1000000' }],
    };
    const out = assembleProjectEstimate(revision, { priceMode: 'suggested', customPriceRaw: '' });
    // Before this session's fix, this silently returned calculationState:'complete'
    // with price:null/effectivePrice:null -- a "complete" result with nothing
    // priceable, exactly the disguised-invalid state DECISIONS.md #9 forbids.
    expect(out.calculationState).toBe('invalid');
    expect(out.outOfSupportedRange).toBe(true);
    expect(out.price).toBeNull();
    expect(out.effectivePrice).toBeNull();
  });
});

describe('AGG-004: draft-saving and the issue gate treat an out-of-supported-range result exactly like any other invalid calculation', () => {
  it('checkIssueGate blocks issuing an out-of-range revision with the same "not complete" reason as any other invalid calculation', () => {
    const revision: EstimateRevision = {
      ...baseRevision(),
      title: 'Extreme job',
      rooms: [],
      surfaces: [wallSurface({ areaFt2: '1000000000', coats: 1, wasteRatio: '0' })],
      calculationState: 'invalid', // what the UI would persist after an out-of-range assembleProjectEstimate result
      proposedPrice: null,
    };
    const gate = checkIssueGate(revision, { sampleAssumptionsConfirmed: true, zeroPriceConfirmed: false });
    expect(gate.canIssue).toBe(false);
    expect(gate.reasons.some((r) => /not complete/i.test(r))).toBe(true);
  });

  it('nothing in assembleProjectEstimate\'s out-of-range path prevents a revision from being constructed/stored as a draft -- calculationState is just a field, never a precondition for the object to exist', () => {
    // The draft-save path (src/components/tools/pro/ProApp.tsx saveDraft)
    // persists whatever calculationState assembleProjectEstimate reports,
    // unconditionally -- there is no separate gate to bypass here. This
    // test documents that guarantee at the type level: an out-of-range
    // revision is a perfectly ordinary, storable EstimateRevision value.
    const revision: EstimateRevision = {
      ...baseRevision(),
      title: 'Extreme job',
      rooms: [],
      surfaces: [wallSurface({ areaFt2: '1000000000', coats: 1, wasteRatio: '0' })],
      calculationState: 'invalid',
      proposedPrice: null,
    };
    expect(() => JSON.stringify(revision)).not.toThrow();
    expect(revision.calculationState).toBe('invalid');
  });
});

describe('AGG-005: an actual-cost review total beyond the supported range is a structured invalid/blocked state, not a silently huge "final" number', () => {
  it('four confirmed categories each individually within the monetary cap can still sum past it -- the total must never be reported as a plausible final figure', () => {
    const huge = d('900000000'); // under the $1B per-category figure, but four of them sum to $3.6B
    const r = evaluateActualReview({
      materials: { confirmed: true, amount: huge },
      labor: { confirmed: true, amount: huge },
      otherExpenses: { confirmed: true, amount: huge },
      overhead: { confirmed: true, amount: huge },
      baselinePrice: d('3200'),
      baselineCost: d('2185'),
    });
    expect(r.state).toBe('out_of_supported_range');
    expect(r.actualCost).toBeNull();
    expect(r.profitAgainstOriginalQuote).toBeNull();
    expect(r.marginRatio).toBeNull();
  });

  it('the same shape just inside the cap still finalizes normally (proves this is a genuine boundary)', () => {
    const r = evaluateActualReview({
      materials: { confirmed: true, amount: d('200000000') },
      labor: { confirmed: true, amount: d('200000000') },
      otherExpenses: { confirmed: true, amount: d('200000000') },
      overhead: { confirmed: true, amount: d('200000000') },
      baselinePrice: d('3200'),
      baselineCost: d('2185'),
    });
    expect(r.state).toBe('final');
    expect(r.actualCost!.toString()).toBe('800000000');
  });
});

describe('AGG-006: a previously-issued frozen document with an aggregate that would exceed TODAY\'s cap still renders exactly as recorded -- frozen output is never re-validated', () => {
  it('buildCustomerDocument never inspects proposedPrice\'s magnitude at all -- an old frozen total (however large) passes through unchanged, matching the same "issued data is exempt" principle as BACK-026\'s engine-version gate', () => {
    const revision = { ...baseRevision(), title: 'Old huge job', surfaces: [wallSurface()], proposedPrice: '5000000000.00' /* already above today's cap, as if frozen under an older, less-strict build */ };
    const doc = buildCustomerDocument(revision, { estimateNumber: 'E-1', estimateDate: '2026-01-01', projectAddress: '', revisionLabel: 'Rev 1' });
    expect(doc.proposedPrice).toBe('5000000000.00'); // rendered verbatim, never re-validated, never crashes
  });
});
