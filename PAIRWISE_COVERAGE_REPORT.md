# Pairwise mode coverage report

Numerical-hardening initiative, section 8. Generator:
`docs/generate_pairwise_cases.cjs`. Generated data:
`tests/pairwise/generated-cases.json`. Executable suites:
`tests/pairwise/{proEstimatePairwise,jobCostPairwise,interiorCalculatorPairwise,lifecyclePairwise}.test.{ts,tsx}`
(71 tests total, all passing).

## Why four sub-models, not one flat 16-dimension array

The 16 named dimensions do not form one combinatorial space in this
product — `tool` fundamentally gates which other dimensions even apply:
the free job-cost calculator has no "surface type" at all; the free
interior calculator has no overhead/target-margin/price-state concept
(it computes materials + labor cost with no margin analysis); only the
Pro estimate exercises the full surface/geometry/pricing richness.
Forcing every dimension into one array would manufacture meaningless
combinations (e.g. "free job-cost × measurement mode") that can never
occur in the real product — this is standard practice in pairwise testing
("sub-modeling" a conditional parameter space), not a shortcut around the
requirement.

| Sub-model | Dimensions | Valid combinations | Valid pairs | Generated cases |
|---|---|---|---|---|
| A. Pro estimate | surfaceType, measurementMode, openingMode, coats, wasteBand, laborRateSource, throughputSource, suppliesMode, overheadBand, priceMode, targetMarginBand, priceState (12) | 96,768 | 609 | 31 |
| B. Free job-cost calculator | materialsMode, laborMode, overheadMode, overheadBand, pricingMode, targetMarginBand (6) | 192 | 92 | 15 |
| C. Free interior calculator | includeWalls, includeCeiling, deductOpenings, coats, wasteBand (5) | 72 | 65 | 13 |
| D. Lifecycle/import | revisionState, actualReviewState, backupConflictMode (3) | 21 | 28 | 12 |
| **Total** | | | **794** | **71** |

## Algorithm

A standard greedy 2-way covering-array generator: repeatedly selects the
still-valid combination that covers the most currently-uncovered valid
pairs, until every valid pair is covered by at least one generated case.
Deterministic (fixed candidate order, no randomness) — re-running
`node docs/generate_pairwise_cases.cjs` reproduces the identical output.

Coverage was independently re-verified (not just trusted from the
generator's own count) by re-scanning the generated case list and
recomputing which pairs it actually covers — confirmed to exactly match
the "valid pairs" total for all four sub-models, 0 gaps.

## Excluded pairs (structurally invalid, not silently dropped)

| Dimensions | Excluded combination | Reason |
|---|---|---|
| surfaceType × measurementMode | trim/door × roomDerived | `resolveSurface()` never branches on `measurementMode` for `kind==='trim'|'door'` — they always read their own direct fields (`trimLengthFt`/`developedWidthFt`, or `doorCount`/`widthFt`/`heightFt`/`paintedSides`). |
| surfaceType × openingMode | trim/door × detailed | Opening-mode deduction is a `Room` property meaningful only for a `roomDerived` wall/ceiling; trim/door have no opening deduction at all. |
| measurementMode × openingMode | manual × detailed | A manual-area surface has no room to deduct openings from. |
| priceMode × priceState | suggested × {zeroPrice, belowCost, belowTarget, aboveTarget} | In suggested-price mode the proposed price IS the computed suggestion by construction — it always lands at (or a hair above) target, never in the other price states, which are only reachable with an independently-entered custom price. |
| includeWalls × includeCeiling | false × false | Nothing enabled to paint is the same "incomplete" state regardless of every other dimension — not a distinct behavior worth its own pairwise slot. |
| revisionState × actualReviewState | draft × {inProgress, final, outOfSupportedRange} | Actual-cost review requires a frozen baseline from an issued revision; a draft has none to review against. |
| revisionState × actualReviewState | {issued, superseded} × none | Once issued, a revision's actual-review always exists in some real state (even "not started" is `in_progress` with 0 confirmed categories) — `none` only applies pre-issue. |

## Genuine findings during construction

Two real, non-obvious domain facts surfaced while making the tests pass —
both are correct existing behavior, not defects, but are worth recording
since a naive pairwise test would have silently mis-asserted around them:

- **`minimumTargetPrice` is a ceiling to the nearest cent**, so a
  `suggested`-price estimate (or a custom price set to exactly
  `minimumTargetPrice`) reaches `status: 'at_target'` only when the true
  required price already lands on a whole cent — otherwise it reaches
  `'above_target'` by construction (rounding up can only add margin, never
  remove it). Both statuses are correct outcomes; which one occurs is a
  data-dependent rounding fact.
- **At `targetMarginBand='zero'`**, `minimumTargetPrice` is approximately
  equal to cost itself, so there is effectively no "below target but above
  cost" price band — a price one cent under the target price often lands
  below cost instead. A zero target margin means "priced exactly at cost"
  already satisfies the target, collapsing that state.

## Exit criteria

- Every valid pair covered: **794/794**
- Uncovered valid pairs: **0**
- Every generated case executed (not merely generated): **71/71**
- Invalid combinations excluded with a documented reason: **7 pair groups**
