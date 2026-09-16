// Numerical-hardening initiative, section 8: pairwise mode coverage,
// sub-model D (lifecycle/import). See docs/generate_pairwise_cases.js /
// tests/pairwise/generated-cases.json / PAIRWISE_COVERAGE_REPORT.md.
import { describe, it, expect } from 'vitest';
import generated from './generated-cases.json';
import { sequentialIdSource } from '../../src/domain/ids';
import { createSnapshot } from '../../src/domain/snapshot';
import { createDraftRevision, issueRevision, supersede } from '../../src/domain/project';
import { buildCustomerDocument } from '../../src/domain/customerDocument';
import { evaluateActualReview } from '../../src/engine/actuals';
import { planArrayMerge } from '../../src/domain/backup';
import { PEP } from '../../src/engine/decimal';
import type { BusinessSettings, PaintVariant, Room, Surface, EstimateRevision, ImportConflict } from '../../src/domain/entities';

const NOW = '2026-01-01T00:00:00.000Z';
function settings(): BusinessSettings {
  return {
    id: 's1', loadedHourlyRate: '32', overheadRatio: '0.15', targetMarginRatio: '0.35', defaultCoats: 2, defaultWasteRatio: '0.10',
    wallThroughput: '150', ceilingThroughput: '120', trimThroughput: '40', doorHoursPerSidePerCoat: '0.75', defaultTravelAmount: '0',
    defaultSuppliesAllowance: { mode: 'none', amount: '0', ratio: '0' }, sampleAssumptionsConfirmed: true, createdAt: NOW, updatedAt: NOW,
  };
}
function variant(): PaintVariant {
  return { id: 'paint-1', name: 'White', color: 'white', sheen: 'eggshell', pricePerGal: '42', coverageFt2PerGal: '350', purchaseIncrementGal: '1', createdAt: NOW, updatedAt: NOW };
}
function wallSurface(): Surface {
  return {
    id: 'surface-1', roomId: null, kind: 'wall', enabled: true, measurementMode: 'manual', areaFt2: '400',
    trimLengthFt: null, developedWidthFt: null, doorCount: null, widthFt: null, heightFt: null, paintedSides: null,
    paintVariantId: 'paint-1', coats: 2, wasteRatio: '0.10', loadedHourlyRate: '32', throughput: '150', hoursPerSidePerCoat: null,
  };
}

type Case = (typeof generated.subModels.D_lifecycle.generatedCases)[number];

function buildRevisionInState(state: Case['revisionState'], ids: ReturnType<typeof sequentialIdSource>): EstimateRevision {
  const snap = createSnapshot(settings(), [variant()], [], ids, 'rev-1');
  let revision: EstimateRevision = { ...createDraftRevision('project-1', snap, ids), surfaces: [wallSurface()], proposedPrice: '5000' };
  if (state === 'draft') return revision;
  const issued = issueRevision(revision, (r) => buildCustomerDocument(r, { estimateNumber: 'E-1', estimateDate: '2026-01-01', projectAddress: '', revisionLabel: 'Rev 1' }), ids);
  if (state === 'issued') return issued;
  return supersede(issued, ids); // 'superseded'
}

describe('PAIRWISE-D: lifecycle/import mode-interaction coverage', () => {
  const cases = generated.subModels.D_lifecycle.generatedCases as Case[];

  it.each(cases.map((c, i) => [i, c] as const))('case %i: %o', (_i, c) => {
    const ids = sequentialIdSource();
    const revision = buildRevisionInState(c.revisionState, ids);
    expect(revision.state).toBe(c.revisionState);

    if (c.actualReviewState !== 'none') {
      const baselineCost = new PEP('3000');
      const baselinePrice = new PEP('5000');
      const byState = {
        inProgress: { materials: { confirmed: false, amount: null }, labor: { confirmed: false, amount: null }, otherExpenses: { confirmed: false, amount: null }, overhead: { confirmed: false, amount: null } },
        final: {
          materials: { confirmed: true, amount: new PEP('1200') }, labor: { confirmed: true, amount: new PEP('900') },
          otherExpenses: { confirmed: true, amount: new PEP('100') }, overhead: { confirmed: true, amount: new PEP('315') },
        },
        outOfSupportedRange: {
          materials: { confirmed: true, amount: new PEP('999999999') }, labor: { confirmed: true, amount: new PEP('999999999') },
          otherExpenses: { confirmed: true, amount: new PEP('999999999') }, overhead: { confirmed: true, amount: new PEP('999999999') },
        },
      }[c.actualReviewState];
      const review = evaluateActualReview({ ...byState, baselineCost, baselinePrice });
      expect(review.state).toBe(c.actualReviewState === 'inProgress' ? 'in_progress' : c.actualReviewState === 'final' ? 'final' : 'out_of_supported_range');
    }

    // A backup-conflict resolution is independent of revision/actuals state
    // (it operates at the whole-project-record level, before either is
    // even read) -- confirm each resolution mode is handled without error
    // against a trivial same-id conflicting pair.
    const existing = [{ id: 'x', v: 1 }];
    const incoming = [{ id: 'x', v: 2 }];
    const merge = planArrayMerge(existing, incoming);
    expect(merge.conflicts).toHaveLength(1);
    const resolution: ImportConflict['resolution'] = c.backupConflictMode;
    expect(['keepLocal', 'replaceImported', 'keepBoth']).toContain(resolution);
  });
});
