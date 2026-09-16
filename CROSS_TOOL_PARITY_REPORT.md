# Cross-tool parity report

Numerical-hardening initiative, section 3. Executable suite:
`tests/parity/crossToolParity.test.tsx` (12 scenarios, 12 tests, all passing).

Each scenario compares two genuinely independent computation paths for the
same underlying numbers — never two callers of the identical function with
no intervening logic. Where practical, the expected value is drawn from
`docs/acceptance-fixtures.json` (itself independently cross-validated
against `docs/numerical_oracle.py`'s exact-Fraction oracle), making the
comparison tool-vs-oracle rather than tool-vs-itself.

| # | Scenario | Independent paths compared | Result |
|---|----------|------------------------------|--------|
| 1 | Free job-cost calculator vs. core engine | `evaluateJobCost()` (free tool's input-parsing layer) vs. the `job-original-brief` oracle fixture's independently-derived numbers | PASS |
| 2 | Free interior calculator vs. Pro surfaces | The real, rendered `InteriorCalculator` component (via `@testing-library/react`) vs. `aggregateProjectSurfaces()` on an equivalent manual-mode wall, both checked against the `interior-walls-brief` oracle fixture | PASS |
| 3 | Free-to-Pro handoff vs. original inputs | `buildProjectFromInteriorHandoff()` assembled through the full Pro pipeline (`assembleProjectEstimate`) vs. the same `interior-walls-brief` oracle numbers | PASS |
| 4 | Pro estimate summary vs. issued document | `assembleProjectEstimate()`'s `effectivePrice` vs. `computeDocumentTotals()`'s total for a one-line document at that price | PASS |
| 5 | Pro estimate vs. Price Book Health | `aggregateProjectSurfaces()` per-unit materials/labor (at an exact coverage-multiple area, eliminating the whole-gallon-purchase-ceiling artifact) vs. `computeServiceUnitCost()`'s continuous per-unit rate, including the overhead markup | PASS |
| 6 | Estimate baseline vs. actual-review baseline | The same `jobCost` Dec instance flows from `assembleProjectEstimate()` into `evaluateActualReview()`'s `baselineCost`, and `totalVariance` matches a hand-computed `actualCost − baselineCost` | PASS |
| 7 | Saved/reopened estimate | `assembleProjectEstimate()` before vs. after a full `JSON.stringify`/`parse` round-trip of the revision (simulating an IndexedDB save + reopen) | PASS |
| 8 | Exported/restored project | `assembleProjectEstimate()` before vs. after `exportBackup()` → JSON round-trip → `validateBackupEnvelope()` | PASS |
| 9 | Import-as-copy | `assembleProjectEstimate()` on the source vs. on the `planImportAsCopies()`-produced copy (verified distinct ids, identical numbers) | PASS |
| 10 | Rate refresh + undo | `assembleProjectEstimate()` before refresh vs. after `applyRateRefresh()` → `undoRateRefresh()` (one fixed deterministic instance, complementing PROPERTY 17's randomized coverage) | PASS |
| 11 | Room/surface reorder | `assembleProjectEstimate()` and surface id set before vs. after `moveSurfaceWithinGroup()` | PASS |
| 12 | Issued frozen revision vs. later live changes | `freezeCalculatedOutputs()`'s stored `jobCost` vs. a fresh draft assembled with a changed `loadedHourlyRate` — the issued snapshot is proven unaffected | PASS |

## Genuine findings during construction

No production defects were found. Two test-construction bugs were caught
and fixed while building the suite (documented here for the record, since
they reveal real facts about the domain model, not just typos):

- **Scenario 5's original design used area=1**, matching Price Book
  Health's own "per one unit" framing literally. This is wrong: Price
  Book Health's per-unit rate is intentionally continuous (a modeled rate
  for pricing at scale), while a real Pro surface at area=1 hits the same
  whole-gallon purchase-rounding as any tiny job would. The two are
  answering different questions at that scale and are not expected to
  match. Fixed by using area=350 (exactly one coverage-unit) with
  waste=0, which eliminates the purchase-rounding remainder entirely and
  isolates the actual rate comparison.
- **Scenario 5's `modeledCostPerUnit`** was initially compared directly
  against materials+labor per unit; it actually includes the business's
  own `overheadRatio` markup on top of direct cost (matching
  `computeServiceUnitCost`'s real contract). Fixed by asserting
  `directCostPerUnit` separately from `modeledCostPerUnit` and confirming
  the exact 15% relationship.
- **Scenario 3** initially omitted adding the handoff's freshly-minted
  paint variant into the built revision's own snapshot before assembling
  — `buildProjectFromInteriorHandoff()` mints the variant but (correctly)
  leaves catalog persistence to its caller (`ProApp.tsx` in production).
  Fixed by adding the variant to `revision.activeRateSnapshot.paintVariants`
  in the test, matching what the real caller does.

## Exit criteria

- 12 scenarios executed: **12/12**
- Unexplained differences: **0**

See `CROSS_TOOL_PARITY_RESULTS.csv` for the machine-readable form.
