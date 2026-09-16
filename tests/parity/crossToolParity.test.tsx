// @vitest-environment jsdom
// Cross-tool parity suite (numerical-hardening initiative, section 3).
//
// Each scenario below compares two GENUINELY independent computation paths
// for the same underlying numbers -- never two callers of the identical
// function with no intervening logic. Where practical, the expected value
// comes from docs/acceptance-fixtures.json (itself independently
// cross-validated against docs/numerical_oracle.py's exact-Fraction
// oracle), so the comparison is tool-vs-oracle, not tool-vs-itself.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PEP } from '../../src/engine/decimal';
import { computeDocumentTotals } from '../../src/engine/document';
import { evaluateActualReview, type ActualCategory } from '../../src/engine/actuals';
import { aggregateProjectSurfaces, type ProjectSurface, type VariantPricing } from '../../src/engine/estimate';
import { evaluateJobCost, type JobCostInputs } from '../../src/components/tools/jobCostCalculatorLogic';
import InteriorCalculator from '../../src/components/tools/InteriorCalculator';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision, issueRevision, moveSurfaceWithinGroup } from '../../src/domain/project';
import { assembleProjectEstimate } from '../../src/domain/estimateAssembly';
import { freezeCalculatedOutputs, readFrozenCalculatedOutputs } from '../../src/domain/calculationSnapshot';
import { previewRateRefresh, applyRateRefresh, undoRateRefresh } from '../../src/domain/rateRefresh';
import { exportBackup, validateBackupEnvelope, planImportAsCopies } from '../../src/domain/backup';
import { assembleServiceHealth } from '../../src/domain/serviceHealthAssembly';
import { buildCustomerDocument } from '../../src/domain/customerDocument';
import { buildProjectFromInteriorHandoff, type InteriorHandoffPayload } from '../../src/domain/interiorHandoff';
import { ENGINE_VERSION } from '../../src/domain/entities';
import type { BusinessSettings, PaintVariant, EstimateRevision, Project, ServiceDefinition, Surface } from '../../src/domain/entities';

afterEach(() => cleanup());

const NOW = '2026-01-01T00:00:00.000Z';
const priceOptions = { priceMode: 'suggested' as const, customPriceRaw: '' };
const d = (n: string) => new PEP(n);

function settings(overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}
function variant(overrides: Partial<PaintVariant> = {}): PaintVariant {
  return { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW, ...overrides };
}
// Engine-level surface (Dec fields), for direct aggregateProjectSurfaces() calls.
function engineWall(overrides: Partial<ProjectSurface> & { geometryOverrides?: Record<string, unknown> } = {}): ProjectSurface {
  const { geometryOverrides, ...rest } = overrides;
  return {
    id: 'wall-1', enabled: true, valid: true,
    geometry: { kind: 'wall', wallOrCeilingAreaFt2: d('400'), ...geometryOverrides },
    paintVariantId: 'paint-1', coats: 2, wasteRatio: d('0.1'), loadedHourlyRate: d('32'), rateOrThroughput: d('150'),
    ...rest,
  } as ProjectSurface;
}
// Domain-level surface (string fields), for assembleProjectEstimate(revision) calls.
function domainWall(overrides: Partial<Surface> = {}): Surface {
  return {
    id: 'wall-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual', areaFt2: '400', trimLengthFt: null,
    developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null, paintVariantId: 'paint-1',
    coats: 2, wasteRatio: '0.1', loadedHourlyRate: null, throughput: null, hoursPerSidePerCoat: null,
    ...overrides,
  };
}
function baseRevision(settingsOverrides: Partial<BusinessSettings> = {}): EstimateRevision {
  const ids = sequentialIdSource();
  const snap = createSnapshot(settings(settingsOverrides), [variant()], [], ids, 'rev-1');
  return createDraftRevision('project-1', snap, ids);
}
const pricing = new Map<string, VariantPricing>([['paint-1', { coveragePerGal: d('350'), pricePerGal: d('42') }]]);

describe('PARITY-01: free job-cost calculator vs. an independently oracle-validated expected value', () => {
  it('the "job-original-brief" acceptance fixture, fed through evaluateJobCost() (the free tool\'s own input-parsing layer), matches the exact-Fraction-oracle-validated numbers', () => {
    // Fixture (docs/acceptance-fixtures.json::job-original-brief), independently
    // validated against docs/numerical_oracle.py: materials=1104, labor=1344,
    // expenses=175, overheadRatio=0.15, targetRatio=0.35, enteredPrice=4640.70
    // -> directCost=2623.00, overhead=393.45, cost=3016.45, approxPrice=4640.69,
    // minimumPrice=4640.70, profit=1624.25, marginPercent=35.0.
    const inputs: JobCostInputs = {
      materialsMode: 'lumpSum', materialsAmount: '1104', paintGallons: '', paintPricePerGal: '', suppliesAmount: '',
      laborMode: 'direct', laborAmount: '1344', laborHours: '', loadedHourlyRate: '',
      travelAmount: '175', otherExpenseLines: [],
      overheadMode: 'percent', overheadPercent: '15', overheadFlat: '', targetPercent: '35',
      pricingMode: 'enterPrice', enteredPrice: '4640.70',
    };
    const result = evaluateJobCost(inputs);
    expect(result.state).toBe('complete');
    if (result.state !== 'complete') return;
    expect(result.directCostValue.toFixed(2)).toBe('2623.00');
    expect(result.overhead.toFixed(2)).toBe('393.45');
    expect(result.cost.toFixed(2)).toBe('3016.45');
    expect(result.price.approxPrice!.toFixed(2)).toBe('4640.69');
    expect(result.price.minimumTargetPrice!.toFixed(2)).toBe('4640.70');
    expect(result.price.profit!.toFixed(2)).toBe('1624.25');
    expect(result.price.marginRatio!.times(100).toFixed(1)).toBe('35.0');
    // The exact ratio 1624.25/4640.70 is a hair above 0.35 (the fixture's
    // "35.0%" is a rounded display figure) -- above_target is the correct
    // exact-decimal status, not at_target.
    expect(result.price.status).toBe('above_target');
  });
});

describe('PARITY-02: free interior calculator vs. an equivalent Pro manual-mode wall surface', () => {
  // docs/acceptance-fixtures.json::interior-walls-brief (oracle-validated):
  // 20x16x9 room, 2 doors (20ft2 each) + 3 windows (15ft2 each), 2 coats,
  // 350 coverage, 10% waste, $42/gal, wallThroughput=150, laborRate=$32/hr,
  // no ceiling -> net wall 563.00ft2, paintCost 168.00, hours 7.506667,
  // laborCost 240.21, total 408.21.
  it('renders those exact inputs in the real InteriorCalculator component and matches the oracle-validated total', () => {
    render(<InteriorCalculator />);
    fireEvent.change(screen.getByLabelText('Length (ft)'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Width (ft)'), { target: { value: '16' } });
    fireEvent.change(screen.getByLabelText('Height (ft)'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Doors (20 ft² each)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Windows (15 ft² each)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Coats'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Coverage (sqft/gal, sample)'), { target: { value: '350' } });
    fireEvent.change(screen.getByLabelText('Waste %'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Price per gallon ($, sample)'), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Estimate labor' }));
    fireEvent.change(screen.getByLabelText('$/hour'), { target: { value: '32' } });
    fireEvent.change(screen.getByLabelText('Wall sqft/hr/coat'), { target: { value: '150' } });

    expect(screen.getByText('Net wall area').nextElementSibling!.textContent).toBe('563.00 ft²');
    expect(screen.getByText('Paint cost').nextElementSibling!.textContent).toBe('$168.00');
    expect(screen.getByText('Labor cost').nextElementSibling!.textContent).toBe('$240.21');
    expect(screen.getByText('Total').nextElementSibling!.textContent).toBe('$408.21');

    // Same net area (563), same coats/waste/coverage/price/throughput/rate,
    // fed through the Pro engine's own manual-mode surface aggregation --
    // a genuinely different code path (aggregateProjectSurfaces, not the
    // component's inline useMemo) landing on the identical numbers.
    const wall = engineWall({ geometryOverrides: { wallOrCeilingAreaFt2: d('563') } });
    const { valid, result } = aggregateProjectSurfaces([wall], pricing);
    expect(valid).toBe(true);
    expect(result!.purchases[0].cost.toFixed(2)).toBe('168.00');
    expect(result!.laborCost.toFixed(2)).toBe('240.21');
    expect(result!.laborCost.plus(result!.purchases[0].cost).toFixed(2)).toBe('408.21');
  });
});

describe('PARITY-03: free-to-Pro handoff vs. the original free-tool inputs', () => {
  it('buildProjectFromInteriorHandoff, assembled through the Pro pipeline, reproduces interior-walls-brief\'s oracle-validated total exactly', () => {
    const ids = sequentialIdSource();
    const snap = createSnapshot(settings({ wallThroughput: '150', loadedHourlyRate: '32' }), [], [], ids, 'rev-1');
    const payload: InteriorHandoffPayload = {
      lengthFt: '20', widthFt: '16', heightFt: '9',
      includeCeiling: false, deductOpenings: true,
      doorCount: '2', windowCount: '3',
      coats: '2', coverageFt2PerGal: '350', pricePerGal: '42', wasteRatioPercent: '10',
      prepHours: '0',
    };
    const built = buildProjectFromInteriorHandoff(payload, snap, ids);
    // buildProjectFromInteriorHandoff mints a brand-new catalog variant
    // (built.variant) but does not itself add it to the revision's own
    // snapshot -- the real caller (ProApp.tsx) does that as part of
    // persisting the new project's full catalog. Do the same here.
    const revisionWithVariant: EstimateRevision = {
      ...built.revision,
      activeRateSnapshot: { ...built.revision.activeRateSnapshot, paintVariants: [...built.revision.activeRateSnapshot.paintVariants, built.variant] },
    };
    const assembly = assembleProjectEstimate(revisionWithVariant, priceOptions);
    expect(assembly.calculationState).toBe('complete');
    expect(assembly.materials!.toFixed(2)).toBe('168.00');
    expect(assembly.laborCost!.toFixed(2)).toBe('240.21');
    expect(assembly.directCost!.toFixed(2)).toBe('408.21');
  });
});

describe('PARITY-04: Pro estimate summary vs. the issued customer-document total', () => {
  it('a single-line document at the suggested price totals to exactly that price (no silent tax addition, matching CALCULATION_SPEC §6)', () => {
    const revision = { ...baseRevision(), surfaces: [domainWall()] };
    const assembly = assembleProjectEstimate(revision, priceOptions);
    expect(assembly.calculationState).toBe('complete');
    const price = assembly.effectivePrice!;
    const totals = computeDocumentTotals([{ quantity: d('1'), unitSellingPrice: price }], false, d('0'));
    expect(totals.total.toFixed(2)).toBe(price.toFixed(2));
    expect(totals.tax.toFixed(2)).toBe('0.00');
  });
});

describe('PARITY-05: Pro estimate vs. Price Book Health under identical per-unit assumptions', () => {
  it('a Pro wall surface at exactly one coverage-unit of area (350ft2, waste=0) matches Price Book Health\'s continuous per-unit rate exactly', () => {
    // area=coverage with waste=0 makes raw demand land on a whole number
    // (350*2*1/350 = 2 exactly) -- no whole-gallon purchase-ceiling residue
    // to complicate the per-unit division, isolating the actual rate
    // comparison this scenario is about. Price Book Health's own per-unit
    // model is intentionally continuous (a rate for pricing at scale, not
    // "what one sqft costs to buy today"), so this is the fair apples-to-
    // apples input, not an area of 1.
    const wall = engineWall({ geometryOverrides: { wallOrCeilingAreaFt2: d('350') }, wasteRatio: d('0') });
    const { valid, result } = aggregateProjectSurfaces([wall], pricing);
    expect(valid).toBe(true);
    const proMaterialsPerUnit = result!.purchases[0].cost.dividedBy(350);
    const proLaborPerUnit = result!.laborCost.dividedBy(350);

    const service: ServiceDefinition = {
      id: 'svc-1', name: 'Wall (std)', kind: 'wall', paintVariantId: 'paint-1', coats: 2, wasteRatio: '0',
      throughput: '150', loadedHourlyRate: '32', additionalLaborHoursPerUnit: '0', suppliesCostPerUnit: '0',
      directExpensePerUnit: '0', currentSellingPrice: null, developedWidthFt: null, widthFt: null, heightFt: null, paintedSides: null, hoursPerSidePerCoat: null,
    } as ServiceDefinition;
    const health = assembleServiceHealth(service, [variant()], settings());
    expect(health.state).toBe('ok');
    if (health.state !== 'ok') return;
    expect(health.row.unitCost!.paintConsumptionCostPerUnit.toFixed(6)).toBe(proMaterialsPerUnit.toFixed(6));
    expect(health.row.unitCost!.laborCostPerUnit.toFixed(6)).toBe(proLaborPerUnit.toFixed(6));
    const proDirectCostPerUnit = proMaterialsPerUnit.plus(proLaborPerUnit);
    expect(health.row.unitCost!.directCostPerUnit.toFixed(6)).toBe(proDirectCostPerUnit.toFixed(6));
    // modeledCostPerUnit adds the business's own overheadRatio (0.15 in the
    // shared `settings()` fixture) on top of direct cost.
    expect(health.row.unitCost!.modeledCostPerUnit.toFixed(6)).toBe(proDirectCostPerUnit.times('1.15').toFixed(6));
  });
});

describe('PARITY-06: estimate job-cost baseline vs. the actual-review starting baseline', () => {
  it('the SAME jobCost value from assembleProjectEstimate flows unchanged into evaluateActualReview\'s baselineCost and its totalVariance', () => {
    const revision = { ...baseRevision(), surfaces: [domainWall()] };
    const assembly = assembleProjectEstimate(revision, priceOptions);
    expect(assembly.calculationState).toBe('complete');
    const baselineCost = assembly.jobCost!;
    const baselinePrice = assembly.effectivePrice!;

    const confirmed = (amount: string): ActualCategory => ({ confirmed: true, amount: d(amount) });
    const review = evaluateActualReview({
      materials: confirmed('50'), labor: confirmed('100'), otherExpenses: confirmed('0'), overhead: confirmed('20'),
      baselineCost, baselinePrice,
    });
    expect(review.state).toBe('final');
    const actualCost = d('50').plus('100').plus('0').plus('20');
    expect(review.actualCost!.toFixed(2)).toBe(actualCost.toFixed(2));
    expect(review.totalVariance!.toFixed(2)).toBe(actualCost.minus(baselineCost).toFixed(2));
  });
});

describe('PARITY-07: saved/reopened estimate vs. the original in-memory calculation', () => {
  it('a full JSON round-trip of the revision (simulating an IndexedDB save + reopen) reassembles to byte-identical output', () => {
    const revision = { ...baseRevision(), surfaces: [domainWall()] };
    const before = assembleProjectEstimate(revision, priceOptions);
    const reopened: EstimateRevision = JSON.parse(JSON.stringify(revision));
    const after = assembleProjectEstimate(reopened, priceOptions);
    expect(after.calculationState).toBe(before.calculationState);
    expect(after.jobCost!.toFixed(2)).toBe(before.jobCost!.toFixed(2));
    expect(after.effectivePrice!.toFixed(2)).toBe(before.effectivePrice!.toFixed(2));
  });
});

describe('PARITY-08: exported/restored project vs. its pre-export calculation', () => {
  it('a project run through exportBackup -> JSON round-trip -> validateBackupEnvelope reassembles to the identical result', () => {
    const ids = sequentialIdSource();
    const revision = { ...baseRevision(), surfaces: [domainWall()] };
    const project: Project = { id: 'project-1', title: 'Test project', revisions: [revision], activeRevisionId: revision.id, actualReviews: [], createdAt: NOW, updatedAt: NOW, version: 1 };
    const before = assembleProjectEstimate(revision, priceOptions);

    const envelope = exportBackup('install-1', settings(), [variant()], [], [], [project], ids);
    const roundTripped = JSON.parse(JSON.stringify(envelope));
    const validated = validateBackupEnvelope(roundTripped, JSON.stringify(roundTripped).length);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const restoredRevision = validated.envelope.projects[0].revisions[0] as EstimateRevision;
    const after = assembleProjectEstimate(restoredRevision, priceOptions);
    expect(after.jobCost!.toFixed(2)).toBe(before.jobCost!.toFixed(2));
    expect(after.effectivePrice!.toFixed(2)).toBe(before.effectivePrice!.toFixed(2));
  });
});

describe('PARITY-09: import-as-copy vs. the original calculation', () => {
  it('a copy planned by planImportAsCopies computes the exact same total as the source (new ids, same numbers)', () => {
    // One shared id source for both the original and the copy -- two
    // independently-constructed sequentialIdSource() instances each start
    // their own counter at "test-id-1", so comparing raw ids across two
    // separate sources would produce a false collision, not a real one.
    const ids = sequentialIdSource();
    const snap = createSnapshot(settings(), [variant()], [], ids, 'rev-1');
    const revision = { ...createDraftRevision('project-src', snap, ids), surfaces: [domainWall()] };
    const project: Project = { id: 'project-src', title: 'Source', revisions: [revision], activeRevisionId: revision.id, actualReviews: [], createdAt: NOW, updatedAt: NOW, version: 1 };
    const before = assembleProjectEstimate(revision, priceOptions);

    const plan = planImportAsCopies([project], 'export-1', new Set(), ids);
    expect(plan.projects).toHaveLength(1);
    const copy = plan.projects[0];
    expect(copy.id).not.toBe(project.id);
    const copyRevision = copy.revisions[0];
    expect(copyRevision.id).not.toBe(revision.id);
    const after = assembleProjectEstimate(copyRevision, priceOptions);
    expect(after.jobCost!.toFixed(2)).toBe(before.jobCost!.toFixed(2));
  });
});

describe('PARITY-10: rate refresh followed by undo vs. the exact pre-refresh result', () => {
  it('applying a live rate change then undoing it restores byte-identical calculated output (one fixed deterministic instance, complementing PROPERTY 17\'s randomized coverage)', () => {
    const ids = sequentialIdSource();
    const oldSnap = createSnapshot(settings(), [variant({ pricePerGal: '42' })], [], ids, 'rev-1');
    const draft = { ...createDraftRevision('project-1', oldSnap, ids), surfaces: [domainWall()] };
    const before = assembleProjectEstimate(draft, priceOptions);

    const liveSnap = createSnapshot(settings(), [variant({ pricePerGal: '55' })], [], ids, 'rev-2');
    const diff = previewRateRefresh(draft, liveSnap);
    expect(diff.missingVariantIds).toHaveLength(0);
    const refreshed = applyRateRefresh(draft, liveSnap, [], ids);
    const afterRefresh = assembleProjectEstimate(refreshed, priceOptions);
    expect(afterRefresh.jobCost!.toFixed(2)).not.toBe(before.jobCost!.toFixed(2)); // sanity: the refresh actually changed something

    const undone = undoRateRefresh(refreshed);
    expect(undone).not.toBeNull();
    const afterUndo = assembleProjectEstimate(undone!, priceOptions);
    expect(afterUndo.jobCost!.toFixed(2)).toBe(before.jobCost!.toFixed(2));
    expect(afterUndo.effectivePrice!.toFixed(2)).toBe(before.effectivePrice!.toFixed(2));
  });
});

describe('PARITY-11: room/surface reorder vs. pre-reorder totals and IDs', () => {
  it('reordering two surfaces within their group changes only array order -- same ids, same totals', () => {
    const wallA = domainWall({ id: 'wall-a' });
    const wallB = domainWall({ id: 'wall-b', areaFt2: '200' });
    const revision = { ...baseRevision(), surfaces: [wallA, wallB] };
    const before = assembleProjectEstimate(revision, priceOptions);
    const beforeIds = revision.surfaces.map((s) => s.id).sort();

    const ids = sequentialIdSource();
    const reordered = moveSurfaceWithinGroup(revision, 'wall-b', 'up', ids);
    const after = assembleProjectEstimate(reordered, priceOptions);
    const afterIds = reordered.surfaces.map((s) => s.id).sort();

    expect(afterIds).toEqual(beforeIds);
    expect(reordered.surfaces.map((s) => s.id)).toEqual(['wall-b', 'wall-a']); // order actually changed
    expect(after.jobCost!.toFixed(2)).toBe(before.jobCost!.toFixed(2));
  });
});

describe('PARITY-12: an issued frozen revision vs. later live settings/catalog changes', () => {
  it('changing the loaded hourly rate after issue leaves the issued revision\'s frozen jobCost unchanged, even though a fresh draft with the new rate computes a different one', () => {
    const revision = { ...baseRevision({ loadedHourlyRate: '32' }), surfaces: [domainWall()] };
    const assembly = assembleProjectEstimate(revision, priceOptions);
    expect(assembly.calculationState).toBe('complete');
    const frozen = freezeCalculatedOutputs(assembly, ENGINE_VERSION);
    const ids = sequentialIdSource();
    const issued = issueRevision(
      { ...revision, rawCalculatedOutputs: frozen },
      (r) => buildCustomerDocument(r, { estimateNumber: 'E-1', estimateDate: '2026-01-01', projectAddress: '', revisionLabel: 'Rev 1' }),
      ids
    );

    const read = readFrozenCalculatedOutputs(issued.rawCalculatedOutputs);
    expect(read.status).toBe('frozen');
    if (read.status !== 'frozen') return;
    expect(read.jobCost!.toFixed(2)).toBe(assembly.jobCost!.toFixed(2));

    // A brand-new draft using a DIFFERENT loaded hourly rate computes a
    // genuinely different jobCost...
    const newDraft = { ...baseRevision({ loadedHourlyRate: '55' }), surfaces: [domainWall()] };
    const newAssembly = assembleProjectEstimate(newDraft, priceOptions);
    expect(newAssembly.jobCost!.toFixed(2)).not.toBe(assembly.jobCost!.toFixed(2));

    // ...but the ISSUED revision's own frozen snapshot is completely
    // unaffected by that later, unrelated change.
    const readAgain = readFrozenCalculatedOutputs(issued.rawCalculatedOutputs);
    expect(readAgain.status).toBe('frozen');
    if (readAgain.status !== 'frozen') return;
    expect(readAgain.jobCost!.toFixed(2)).toBe(assembly.jobCost!.toFixed(2));
  });
});
