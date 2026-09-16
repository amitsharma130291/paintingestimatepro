// Numerical-hardening initiative, section 8: pairwise mode coverage.
//
// The 16 dimensions from the spec do not form one flat combinatorial space
// in this product -- `tool` fundamentally gates which other dimensions even
// apply (the free job-cost calculator has no "surface type"; the free
// interior calculator has no overhead/target-margin/price-state concept at
// all; only the Pro estimate exercises the full geometry+pricing richness).
// This is standard practice in pairwise testing ("sub-modeling" a
// conditional parameter space) rather than a shortcut: forcing every
// dimension into one array would manufacture meaningless combinations
// (e.g. "free job-cost x measurement mode") that can never occur in the
// real product, diluting genuine coverage.
//
// Four independent sub-models are generated, each pairwise-complete within
// itself:
//   A. Pro estimate: surface/geometry/pricing (12 dimensions)
//   B. Free job-cost calculator (6 dimensions)
//   C. Free interior calculator (5 dimensions)
//   D. Lifecycle/import (3 dimensions: revision state, actual-review
//      state, backup conflict mode)
//
// Algorithm: a standard greedy pairwise (2-way) covering-array generator --
// repeatedly picks the candidate tuple (from all valid combinations) that
// covers the most currently-uncovered valid pairs, until every valid pair
// is covered by at least one generated case. Seeded/deterministic (no
// randomness): ties are broken by a fixed candidate order, so re-running
// this script produces the identical output every time.

const fs = require('fs');
const path = require('path');

function cartesian(dims) {
  const keys = Object.keys(dims);
  let acc = [{}];
  for (const key of keys) {
    const next = [];
    for (const partial of acc) {
      for (const value of dims[key]) {
        next.push({ ...partial, [key]: value });
      }
    }
    acc = next;
  }
  return acc;
}

function allPairs(keys) {
  const pairs = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      pairs.push([keys[i], keys[j]]);
    }
  }
  return pairs;
}

function pairKey(k1, v1, k2, v2) {
  return `${k1}=${v1}|${k2}=${v2}`;
}

// Greedy 2-way covering-array generator over a set of VALID combinations
// (already constraint-filtered) for one sub-model.
function generatePairwise(dims, validCombos) {
  const keys = Object.keys(dims);
  const pairs = allPairs(keys);

  // Every valid pair (k1=v1, k2=v2) that actually appears in at least one
  // valid combination -- pairs that can never co-occur under the
  // constraints are excluded from the "must cover" set, and reported
  // separately as excluded, not silently treated as covered.
  const validPairKeys = new Set();
  for (const combo of validCombos) {
    for (const [k1, k2] of pairs) {
      validPairKeys.add(pairKey(k1, combo[k1], k2, combo[k2]));
    }
  }

  const uncovered = new Set(validPairKeys);
  const selected = [];

  function coverageScore(combo) {
    let score = 0;
    for (const [k1, k2] of pairs) {
      if (uncovered.has(pairKey(k1, combo[k1], k2, combo[k2]))) score++;
    }
    return score;
  }

  while (uncovered.size > 0) {
    let best = null;
    let bestScore = -1;
    for (const combo of validCombos) {
      const score = coverageScore(combo);
      if (score > bestScore) {
        bestScore = score;
        best = combo;
      }
    }
    if (!best || bestScore === 0) break; // shouldn't happen if validPairKeys is non-empty
    selected.push(best);
    for (const [k1, k2] of pairs) {
      uncovered.delete(pairKey(k1, best[k1], k2, best[k2]));
    }
  }

  return { selected, totalValidPairs: validPairKeys.size, dims: keys };
}

// ---------------------------------------------------------------------
// Sub-model A: Pro estimate (surface/geometry/pricing)
// ---------------------------------------------------------------------
const dimsA = {
  surfaceType: ['wall', 'ceiling', 'trim', 'door'],
  measurementMode: ['manual', 'roomDerived'], // only meaningful for wall/ceiling
  openingMode: ['quick', 'detailed'], // only meaningful for roomDerived wall/ceiling
  coats: [1, 2, 5], // floor, typical, ceiling (CALCULATION_SPEC 1..5)
  wasteBand: ['zero', 'normal', 'highWarn', 'max'], // 0, 0.10, 0.6 (>0.5 warns), 1
  laborRateSource: ['settingsDefault', 'surfaceOverride'],
  throughputSource: ['settingsDefault', 'surfaceOverride'],
  suppliesMode: ['none', 'flat', 'paintPercent'],
  overheadBand: ['zero', 'normal', 'highWarn', 'max'], // 0, 0.15, 0.6 (>0.5 warns), 1
  priceMode: ['suggested', 'custom'],
  targetMarginBand: ['zero', 'normal', 'nearMax'], // 0, 0.35, 0.999
  priceState: ['unpriced', 'zeroPrice', 'belowCost', 'belowTarget', 'atTarget', 'aboveTarget'],
};
function validA(c) {
  // measurementMode/openingMode only apply to wall/ceiling; trim/door use
  // their own direct fields (resolveSurface never branches on
  // measurementMode for kind==='trim'|'door' -- src/domain/estimateAssembly.ts).
  if ((c.surfaceType === 'trim' || c.surfaceType === 'door')) {
    if (c.measurementMode !== 'manual') return false; // pin to a single value to avoid a meaningless duplicate axis
    if (c.openingMode !== 'quick') return false;
  }
  // openingMode (deduction quick/detailed) only meaningful for a
  // roomDerived wall/ceiling -- a manual-mode surface has no room to
  // deduct openings from.
  if ((c.surfaceType === 'wall' || c.surfaceType === 'ceiling') && c.measurementMode === 'manual' && c.openingMode !== 'quick') {
    return false;
  }
  // priceState is a computed OUTCOME of (cost, price, targetMargin), not an
  // independent input -- 'unpriced'/'zeroPrice' are only reachable at
  // priceMode='custom' with no/zero entered price; 'suggested' mode always
  // prices at the computed suggestion, landing 'atTarget' (or extremely
  // close), never below-cost/below-target/above-target by construction.
  if (c.priceMode === 'suggested' && c.priceState !== 'atTarget') return false;
  if (c.priceMode === 'custom' && c.priceState === 'atTarget') {
    // still reachable (an entered price that happens to equal the
    // suggestion) -- keep, no exclusion needed here.
  }
  return true;
}
const combosA = cartesian(dimsA).filter(validA);
const pairwiseA = generatePairwise(dimsA, combosA);

// ---------------------------------------------------------------------
// Sub-model B: Free job-cost calculator
// ---------------------------------------------------------------------
const dimsB = {
  materialsMode: ['lumpSum', 'itemized'],
  laborMode: ['direct', 'hoursRate'],
  overheadMode: ['percent', 'flat'],
  overheadBand: ['zero', 'normal', 'highWarn', 'max'],
  pricingMode: ['solveForPrice', 'enterPrice'],
  targetMarginBand: ['zero', 'normal', 'nearMax'],
};
function validB() { return true; } // every combination here is independently reachable
const combosB = cartesian(dimsB).filter(validB);
const pairwiseB = generatePairwise(dimsB, combosB);

// ---------------------------------------------------------------------
// Sub-model C: Free interior calculator
// ---------------------------------------------------------------------
const dimsC = {
  includeWalls: [true, false],
  includeCeiling: [true, false],
  deductOpenings: [true, false],
  coats: [1, 2, 5],
  wasteBand: ['zero', 'normal', 'highWarn', 'max'],
};
function validC(c) {
  if (!c.includeWalls && !c.includeCeiling) return false; // nothing to paint at all -- not a distinct behavior, just "incomplete"
  return true;
}
const combosC = cartesian(dimsC).filter(validC);
const pairwiseC = generatePairwise(dimsC, combosC);

// ---------------------------------------------------------------------
// Sub-model D: Lifecycle/import
// ---------------------------------------------------------------------
const dimsD = {
  revisionState: ['draft', 'issued', 'superseded'],
  actualReviewState: ['none', 'inProgress', 'final', 'outOfSupportedRange'],
  backupConflictMode: ['keepLocal', 'replaceImported', 'keepBoth'],
};
function validD(c) {
  // Actuals only exist against an ISSUED (or superseded, i.e. formerly
  // issued) revision -- a draft has no baseline to review actuals against.
  if (c.revisionState === 'draft' && c.actualReviewState !== 'none') return false;
  if (c.revisionState !== 'draft' && c.actualReviewState === 'none') return false;
  return true;
}
const combosD = cartesian(dimsD).filter(validD);
const pairwiseD = generatePairwise(dimsD, combosD);

// ---------------------------------------------------------------------
// Excluded pairs report (structurally invalid combinations, with reason)
// ---------------------------------------------------------------------
const excluded = [
  { dims: 'surfaceType x measurementMode', pair: 'trim/door x roomDerived', reason: 'trim/door surfaces never branch on measurementMode -- resolveSurface() (src/domain/estimateAssembly.ts) always reads their own direct fields (trimLengthFt/developedWidthFt, or doorCount/widthFt/heightFt/paintedSides) regardless of this field.' },
  { dims: 'surfaceType x openingMode', pair: 'trim/door x detailed', reason: 'opening-mode deduction is a Room property meaningful only for a roomDerived wall/ceiling; trim/door surfaces have no opening deduction at all.' },
  { dims: 'measurementMode x openingMode', pair: 'manual x detailed', reason: 'a manual-area surface has no room to deduct openings from -- openingMode only matters once measurementMode=roomDerived.' },
  { dims: 'priceMode x priceState', pair: 'suggested x {zeroPrice, belowCost, belowTarget, aboveTarget}', reason: 'in suggested-price mode the proposed price IS the computed suggestion by construction, always landing at (or immeasurably close to) the target -- the other price states are only reachable in custom-price mode where the user enters an independent figure.' },
  { dims: 'includeWalls x includeCeiling', pair: 'false x false', reason: 'nothing enabled to paint is the same "incomplete" state regardless of which other dimensions vary -- not a distinct behavior worth a dedicated pairwise slot.' },
  { dims: 'revisionState x actualReviewState', pair: 'draft x {inProgress, final, outOfSupportedRange}', reason: 'actual-cost review requires a frozen baseline from an issued revision -- a draft has none to review against.' },
  { dims: 'revisionState x actualReviewState', pair: '{issued, superseded} x none', reason: 'once a revision is issued, its actual-cost review always exists in some state (even "not started" is represented as in_progress with 0 confirmed categories, not the special "none" state that only applies pre-issue).' },
];

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------
const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  subModels: {
    A_proEstimate: { dims: dimsA, totalValidCombinations: combosA.length, totalValidPairs: pairwiseA.totalValidPairs, generatedCases: pairwiseA.selected },
    B_freeJobCost: { dims: dimsB, totalValidCombinations: combosB.length, totalValidPairs: pairwiseB.totalValidPairs, generatedCases: pairwiseB.selected },
    C_freeInterior: { dims: dimsC, totalValidCombinations: combosC.length, totalValidPairs: pairwiseC.totalValidPairs, generatedCases: pairwiseC.selected },
    D_lifecycle: { dims: dimsD, totalValidCombinations: combosD.length, totalValidPairs: pairwiseD.totalValidPairs, generatedCases: pairwiseD.selected },
  },
  excludedPairs: excluded,
};

const outDir = path.join(__dirname, '..', 'tests', 'pairwise');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'generated-cases.json'), JSON.stringify(out, null, 2));

for (const [name, m] of Object.entries(out.subModels)) {
  console.log(`${name}: ${m.generatedCases.length} cases covering ${m.totalValidPairs} valid pairs (from ${m.totalValidCombinations} valid combinations, ${Object.keys(m.dims).length} dimensions)`);
}
console.log('excluded pair groups:', excluded.length);
