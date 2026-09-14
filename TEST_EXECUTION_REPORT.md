# Test execution report

**This is a v4 continuation session**, working from the same `painting-estimate-pro-specs-v2.1-final.zip` / `painting-estimate-pro-comprehensive-tdd-v2.1.zip` pair (byte-identical to what's already in `docs/`, reconfirmed via `diff -q`) plus the v3 source/reports as its own starting point. This top section (§V4) documents this session's own findings, fixes, and corrected counts; §0 below it is the v3 session's own report (kept as history, with an added note where superseded); §§1-8 below that are the original session's report, kept as history under v3's own disclosure.

---

## V4. v4 continuation session (this session)

### V4.1 Baseline verification (task item 1)

The v4 task's own claim — "252 passing automated tests; 153 passed, 186 not_run, 6 blocked acceptance cases; 20 numerical reference fixtures / 106 fields" — was independently verified before any change, per the task's explicit instruction: `npx vitest run` → 252/252, 29 files; `npx astro check` → 0 errors; `ACCEPTANCE_MATRIX.csv` → 153 passed / 186 not_run / 6 blocked / 0 failed (345 total); `python3 docs/verify_reference.py` → 20 fixtures, 106 fields, all pass. **All three claims were accurate.** Raw command output captured under `evidence/v4-baseline/`.

The task's own framing also stated, correctly this time, that the prior session's "only payment credentials remain" conclusion was wrong — this session confirmed that by finding and fixing two serious security defects and several real correctness/completeness gaps that had nothing to do with missing credentials (below).

### V4.2 Defects found and fixed this session, in the order worked

Every fix below followed the same regression-first discipline used throughout this project: a test was written and run RED against the actual production code first (not a reimplementation of it), the defect was fixed, and the same test was re-run GREEN — full detail, root cause, and verification evidence for each is in `BUG_FIX_LOG.md`.

1. **(Serious, security) ACCESS-013 — checkout verification, license redemption, and the payment webhook granted access for ANY successful Dodo payment, never confirming it purchased the configured product.** A real payment for an unrelated product (or a different price/SKU) on the same Dodo merchant account would have unlocked Pro for free. Fixed with a single shared `evaluatePaymentEntitlement()` decision used identically by all three call sites. `BUG_FIX_LOG.md #22`.
2. **(Serious, security) ACCESS-014 — a network failure (real or simulated) let a completely fabricated local payment record unlock Pro permanently.** The task's own exact reproduction (invented payment ID + a rejecting `fetch`) was confirmed against the original code and closed: `checkAccess()` now reports a distinct `unavailable` status on a network failure — never granted access, but also never clearing the record — rather than returning the untrusted stored record as if it had been verified. `BUG_FIX_LOG.md #23`.
3. **Backup validation covered only a small fraction of the approved schema.** A `null` entry anywhere in the nested arrays threw an uncaught exception; most entity types (`BusinessSettings`, `Room`, `Surface`, `RateSnapshot` internals, every line-item array) were never field-validated at all; duplicate-ID checks covered only paint variants; a paint variant with zero coverage (a real divide-by-zero risk) was accepted as merely "non-negative"; an actual review could target a draft revision instead of an issued one. Rewrote `validateBackupEnvelope` around crash-proof per-entity validators covering the complete `DATA_CONTRACT.md` schema. `BUG_FIX_LOG.md #24`.
4. **Import-as-copies left room/surface IDs and their cross-references untouched, and `exportBackup` silently discarded accumulated import provenance on every export.** `BUG_FIX_LOG.md #25`.
5. **Completed the backup import subsystem**: a real conflict-preview/choice/confirm/cancel UI now exists for all three `DATA_CONTRACT.md`-named import modes (restore/merge — already partially built in v3, import-as-copies, and replace-all, both previously entirely unwired), `otherMaterials`/`serviceDefinitions` are now actually restored on import (previously exported but silently dropped), persisted import provenance now survives across sessions, and every project write in an import commit is checked against its current stored version inside the same atomic transaction — closing the exact two-tab scenario the task described (a stale import preview can no longer silently overwrite a newer concurrent edit). `BUG_FIX_LOG.md #26`.
6. **The free estimate template claimed "saved locally in your browser" even when the save silently failed** (a full quota or private-browsing storage block). Now reports the truth, offers a working Retry action, and preserves a corrupted stored value's raw bytes under a backup key instead of silently discarding them. Live-verified in the browser with a monkey-patched throwing `localStorage.setItem`. `BUG_FIX_LOG.md #27`.
7. **Built a real component-level browser test harness for `ProApp`** (new dev-only test tooling: `jsdom` + `@testing-library/react`), closing the task's explicit demand to test the real Confirm/Cancel/Keep-local/Use-imported/Keep-both actions and the two-tab save conflict's real Reload-latest/Save-as-copy actions through actual rendered DOM and real storage transactions, not just constructed record arrays. `BUG_FIX_LOG.md #28`.

### V4.3 Commands run this session (after all fixes)

```
npx vitest run       # 339/339 passed, 37 files (87 new tests this session)
npx astro check      # 0 errors, 0 warnings, 3 pre-existing FormEvent-deprecation hints (unrelated)
npx astro build      # 5 pages prerendered, server bundle built, succeeds
python3 docs/verify_reference.py  # 20 fixtures / 106 fields, unchanged (no calculation-contract code touched)
```

### V4.4 Acceptance matrix — corrected counts

| Status | Start of this session (v3 end state) | End of this session |
|---|---|---|
| `passed` | 153 | **159** |
| `not_run` | 186 | **181** |
| `blocked` | 6 | **5** |
| `failed` | 0 | **0** |

Implementation status: **254 implemented** (was 250), **59 missing** (was 61), **32 partial** (was 34). `ACCESS-005` and `ACCESS-009` moved from `blocked`/`not_run` to `passed` (the wrong-product and offline-network defects were unfinished implementation, not external dependencies — now fixed and tested). `BACK-006/007` moved to fully `passed` (the room/surface remap gap closed). `BACK-010/011` (the `replaceAll` import mode) moved from `missing`/`not_run` to `implemented`/`passed` — a real, previously entirely-unbuilt feature, now implemented. `BACK-022` moved to `passed` (the atomic multi-store import commit closes the "quota exhausted mid-import" partial-restore risk). `ACCESS-002`'s evidence was refreshed to reflect that its underlying function was superseded by the ACCESS-014 fix, without needing to reopen it as newly-broken — the guarantee it names is preserved and re-verified by the rewritten test file. **No case was reopened as newly-failed** — every case touched this session moved in the correct direction (fixed and re-verified), and none of the fixes invalidated a previously-genuine pass.

**Newly discovered regression cases this session, distinguishable from the original 345** (per the task's explicit instruction): the two security defects (ACCESS-013 product-binding, ACCESS-014 offline-bypass) map cleanly onto existing catalogue cases (`ACCESS-005`, `ACCESS-009`) and did not need new case IDs. The free-template "claims saved when it wasn't" defect (item 9) does **not** have a matching original case ID in the 345-case catalogue (the closest, `LIFE-009`, is about the Pro workspace's IndexedDB persistence, a different storage layer already correctly handled) — this is recorded as a genuinely new finding, fixed and tested (`BUG_FIX_LOG.md #27`), but intentionally not force-mapped onto an unrelated case ID.

### V4.5 What remains unfinished this session (not blocked) — honest backlog

Per item 10's explicit list and this session's own review of the remaining catalogue, none of the following are external-dependency blockers — they are unimplemented features, named honestly rather than declared non-blocking without approval:

- **Interior calculator**: no ceiling-only mode (walls cannot be disabled — `INT-008/009`), no quick/detailed opening-entry switch (`INT-010`), no additional prep-labor line (`INT-014`). Scoped but not built this session.
- **Logo/asset handling in backups and print output** (`BACK-019/025`): `BusinessInfo.logo` is an unused optional field; no upload UI, size-limiting, or embedding exists.
- **`ACCESS-001/003/004/008`**: still genuinely blocked on a real Dodo Payments test-mode account — the one legitimate external dependency, unchanged from v3.
- **`BACK-026`**: still blocked on an unresolved product/policy decision named in its own case text, not an implementation gap.
- Every other `not_run` case (181 total) carries forward from v3's own disclosure — predominantly pure calculation-contract cases already covered by extensive existing engine test suites but not individually cross-referenced case-by-case, plus the free-tool/logo gaps just named.

---

## 0. v3 continuation session (historical — see §V4 above for this session's current findings)

### 0.1 Baseline reconciliation (task item 1)

The task's own framing cited "179 passing automated tests" against "345 named acceptance cases" and warned explicitly not to conflate the two. Both numbers needed correcting before use:

- **Automated test count**: the actual count at the start of this session (i.e., the end of the prior continuation session, after its Dodo Payments work) was **237 tests, 29 files** — not 179. 179 was a stale figure from an earlier point in the project's history; this session used the real, freshly-measured number instead of the one quoted in the task.
- **Acceptance-case count**: `test-execution-results.csv` (345 rows) is a *different measurement* from the automated test count — one row can be verified by a pure unit test, a live browser action, a source-reading judgment call, or nothing at all (`not_run`). The task's own quoted breakdown ("131 passed, 179 not run, 27 blocked, 8 failed") does not match either this session's starting CSV (135 passed / 187 not_run / 15 blocked / 8 failed — see the prior session's §4 below) or any interim state this session could locate; it is treated as stale and superseded by the actual CSV state at each point cited below, per the task's own instruction not to conflate different measurements.

### 0.2 Commands run this session

```
npx vitest run       # start of session: 237/237 passed, 29 files
npx astro check      # 0 errors throughout
npx astro build      # succeeds throughout
```
Re-run after every fix in this session (see `BUG_FIX_LOG.md` entries #19-#21 for the exact before/after count at each step):
```
npx vitest run       # end of session: 252/252 passed, 29 files (15 new tests this session)
npx astro check      # 0 errors, 0 warnings, 3 pre-existing FormEvent-deprecation hints (unrelated)
npx astro build      # 5 pages prerendered, server bundle built, succeeds
```
No `verify_reference.py` fixtures changed this session (no calculation-contract code was touched — see item 8's scope below), so its 20/20-fixture result from the prior session stands unchanged.

### 0.3 What this session fixed

Continuing directly from the prior session's named gaps (§7 below), this session:

1. **BACK-015/020** (`BUG_FIX_LOG.md` #19): `validateBackupEnvelope` now rejects a dangling `actualReviews[].baselineIssuedRevisionId`, and rejects negative/non-decimal financial scalars and unknown enum values in imported paint variants and revisions — all before any write. Also closed a related latent bug in `planImportAsCopies`: an actual review whose baseline can't be remapped is now dropped rather than carried over with a dangling reference.
2. **BACK-004/005/006/017 — the real conflict-resolution UI** (`BUG_FIX_LOG.md` #20): backup import now computes a full preview (`planFullRestoreMerge`, covering projects, the paint catalog, and the business-settings singleton) before any write, lets the user choose Keep local / Use imported / Keep both per conflict, and commits everything in one atomic transaction only on explicit confirmation; cancelling writes nothing. This closes the exact gap the prior session's §7 risk #3 named. Export was also fixed to read `otherMaterials`/`serviceDefinitions` from live storage instead of hardcoding `[]`.
3. **INT-013/UX-013** (`BUG_FIX_LOG.md` #21): the free interior calculator now defaults door/window counts to explicit `0` (not blank), labels sample data explicitly, and a real free-to-Pro handoff (`src/domain/interiorHandoff.ts`) carries supported fields exactly, explains unsupported ones, and never fabricates a default.
4. **TPL-010/011/012/014** (`BUG_FIX_LOG.md` #15, from just before this session's compaction boundary but verified again as part of this session's full-suite reruns): the complete tax validation-to-output path, zero-total no-charge confirmation, and duplicate independence in the free estimate template.
5. **JOB-005/006/007/008** (`BUG_FIX_LOG.md` #17, same note as above): materials/labor mode toggles and a real multi-line other-expenses list in the free job-cost calculator.
6. **ACCESS-002** (`BUG_FIX_LOG.md` #16, same note as above): the `NetworkFailure` fail-open/fail-closed security fix, live-verified both before and after with a forged `localStorage` payment record.
7. **Revision selector** (`BUG_FIX_LOG.md` #18, same note): previously issued revisions are now reachable/reprintable from the Pro workspace UI.

None of this session's own new work (items 1-2 above) could be live-verified in the browser: the backup/import UI lives inside the Pro workspace, and this environment has no real Dodo Payments credentials to unlock it — the same disclosed limitation that already applied to the revision selector. All of it is verified by the passing automated suite (15 new tests this session: 7 for BACK-015/020, 7 for the conflict UI, plus the interior handoff round-trip already existed) and direct code reading, never claimed as browser-verified.

### 0.4 Acceptance matrix — corrected counts (task item 9)

`ACCEPTANCE_MATRIX.csv` (this session's deliverable, superseding `test-execution-results.csv`) was updated for every case this session touched, and — per the task's explicit instruction that "missing implementation is unfinished work, not an external blocker" — **9 cases previously marked `blocked` were relabeled `not_run`** because their actual status was an unimplemented feature (a `replaceAll` import mode with no code behind it at all — BACK-010/011; logo embedding, also entirely unimplemented — BACK-019/025; three free interior-calculator feature gaps — INT-008/009/010/014), not an external dependency. Conversely, **5 `ACCESS-*` cases were relabeled from `not_run` to `blocked`**, since their own notes already named the same concrete external dependency (a real Dodo Payments test-mode account) preventing execution — `blocked` is the semantically correct status for those, not `not_run`. `BACK-026` remains `blocked` for a different, genuine reason: its own case text names an unresolved product/policy decision ("Resolve display-compatibility policy before implementation") that this engineering session cannot make unilaterally.

| Status | Start of this session | End of this session |
|---|---|---|
| `passed` | 135 | **153** |
| `not_run` | 187 | **186** |
| `blocked` | 15 | **6** |
| `failed` | 8 | **0** |

Implementation status: **250 implemented** (was 234), **61 missing** (was 73), **34 partial** (was 38).

**Newly discovered regression/gap cases this session** (distinguishable from the original 345, per the task's explicit instruction): none — every fix this session closed an existing named case from the original 345-case catalogue; no new case IDs were invented. The `planImportAsCopies` dangling-fallback defense-in-depth fix (§0.3 item 1) is covered under BACK-015's existing test evidence, not a new case.

### 0.5 What remains unfinished (not blocked) — honest backlog, not claimed as done

- **BACK-010/011** (replaceAll import mode): no implementation exists. Scoped but not built this session — a real feature, not a quick fix.
- **BACK-019/025** (logo embedding in backup/print): no implementation exists (`BusinessInfo.logo` is an unused optional field).
- **INT-008/009/010/014** (interior calculator: ceiling-only mode, quick/detailed opening-mode switching, an extra labor/prep-hours line): real, scoped gaps in the free tool, not built this session.
- **ACCESS-001/003/004/005/008** (genuinely blocked): need a real Dodo Payments test-mode account to exercise end-to-end — the concrete external dependency named in task item 9's own guidance.
- **BACK-026**: needs an explicit product/policy decision from the user before implementation.
- The **186 `not_run` cases** carry forward from the prior session's own §4/§7 disclosure below — most are pure calculation-contract cases already covered by extensive existing engine test suites (CORE/GEO/NUM/COST/HEALTH/BOUND) but not individually cross-referenced case-by-case; a small number are real, disclosed UI/UX polish gaps (§7 below).

---

## 1. What changed this session

**New engine/domain code** (closes the "Pro UI doesn't match the domain model" gap named explicitly in the task):
- `src/engine/estimate.ts` — `aggregateProjectSurfaces`, a pure per-surface-kind dispatcher (wall/ceiling/trim/door) that pools paint demand by variant across ALL enabled surfaces project-wide, never per-room, and propagates "enabled+invalid blocks the whole project" without ever silently dropping a bad surface.
- `src/domain/estimateAssembly.ts` — `assembleProjectEstimate`, the domain-layer glue turning persisted `Room`/`Surface` string fields + a `RateSnapshot` into the engine calculation, resolving per-surface overrides against snapshot defaults.
- `src/domain/rateRefresh.ts` — `previewRateRefresh`/`applyRateRefresh`: explicit rate refresh covering BOTH paint-catalog and business-settings drift in one mechanism (a `RateSnapshot` bundles both), with mandatory retain-or-replace resolution for a paint variant since deleted from the live catalog, and custom prices never touched by a refresh.
- `src/domain/project.ts`'s `upsertRevision` — append-or-replace a revision into a project's `revisions[]` (see BUG_FIX_LOG #7).
- `src/storage/db.ts`'s `writeProjectWithVersionCheck` / `ConflictError` — optimistic-concurrency multi-tab conflict rejection.

**Pro app UI rewrite** (`src/components/tools/pro/ProApp.tsx`) — replaced the prior session's simplified single-variant-per-room prototype with a UI driven by the real `Room`/`Surface` domain model: independent wall/ceiling paint variant per room, standalone trim/door surfaces, a saved-drafts project list, rate-refresh preview/confirm/cancel panel, a conflict-resolution banner (reload vs. save-as-copy), business/customer info entry, and a working print/PDF path for the issued customer document.

**14 real defects found and fixed this continuation session** (on top of 3 from the prior session — 17 total, all in `BUG_FIX_LOG.md` with full reproduction/root-cause/fix/verification detail):
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
14. While implementing Dodo Payments: a full refund would not have revoked access — Dodo tracks refunds via a separate `refund_status` field, not `payment.status`. Found by reading the SDK's own type definitions before any real payment was ever processed against this codebase; fixed in the same commit as its discovery.

## 2. Numerical fixtures and independent oracle (unchanged, re-verified)

`npx vitest run tests/engine/fixtures.test.ts` and `python3 docs/verify_reference.py` both still pass at 20/20 fixtures, 106 fields, after every change this session — reconfirmed at the final full-suite run, not assumed from the prior session's result.

## 3. Automated test suite (188 tests, 25 files, all passing)

New files added this continuation session, on top of the prior session's 18:
- `tests/engine/estimate.test.ts` (7 tests) — `aggregateProjectSurfaces`: independent wall/ceiling variant pooling, standalone trim/door, disabled-surface exclusion, enabled-and-invalid propagation.
- `tests/domain/estimateAssembly.test.ts` (7 tests) — the same behaviors through the actual `Room`/`Surface` entity shapes, plus the suggested-price profit/margin regression (bug #5) and the variant-not-in-snapshot regression (bug #6's underlying invariant).
- `tests/domain/rateRefresh.test.ts` (7 tests) — preview diff correctness, retain/replace for a deleted variant, custom-price preservation, refusal to refresh an issued revision.
- `tests/storage/versionConflict.test.ts` (4 tests) — `writeProjectWithVersionCheck` against real `fake-indexeddb` transactions: fresh write, matching-version write, stale-write rejection, `ConflictError` carries the current record.
- `tests/integration/draftIssuedIsolation.test.ts` (2 tests, parameterized over suggested/custom pricing) — the full 11-step sequence from the task: draft A at $42 → save → live catalog to $49 → reload A still $42 → draft B sees $49 → preview refresh on A → cancel (A unchanged in storage) → confirm refresh (A now $49) → issue A → edit as new draft, widen scope → confirm the ORIGINAL issued revision's inputs/rates/price/customer document are byte-identical to before the edit. This is the test that caught bug #4 on its first run.
- `tests/integration/backupRestoreStorage.test.ts` (5 tests) — export completeness (issued revision + rate snapshot + actual review survive), structural absence of any payment/entitlement-like string in exported JSON, restore-into-empty-store through real transactions, repeated restore not duplicating, corrupt import causing zero writes.
- `tests/lib/license.test.ts` (9 tests) — the pure, network-free parts of the Dodo Payments integration: `buildLicenseKey`/`parseLicenseKey` round-trip and rejection of malformed/foreign-format keys, `buildRecoveryUrl` construction. The parts that actually call Dodo's API (checkout, verify, redeem, recover, webhook signature verification) are not unit-testable without a real or sandboxed Dodo API key, which this session did not have — see §6.
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
| `passed` | **135** | A real test/manual-verification citation was read and confirmed to check that exact case. |
| `not_run` | **187** | No test exercises this exact scenario; `notes` says whether the underlying behavior looks correct by code reading or is a real gap. |
| `blocked` | **15** | 15 cases genuinely blocked on a feature not built this session (backup conflict-resolution UI, free-tool alternate modes) — no longer includes `ACCESS-*`, since payment is now implemented (§6). |
| `failed` | **8** | An executed check (a test, or direct source reading against the case's exact Given/When/Then) demonstrated the described behavior does NOT hold. |

Implementation status: **234 implemented, 73 missing, 38 partial.** (BACK-004/017 moved from `failed`/`missing` to `not_run`/`partial` after this session's fix wiring `planRestoreMerge` into the actual restore path — see BUG_FIX_LOG.md #13. All 12 `ACCESS-*` cases moved from `external_dependency`/`blocked` to `implemented`/`not_run` or `passed` after this session's Dodo Payments implementation — see §6.)

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
| ACCESS | 12 | 4 | 8 | 0 | 0 |
| **Total** | **345** | **135** | **187** | **15** | **8** |

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

## 6. Paid access — implemented (Dodo Payments), not yet exercised against a real account

The user selected **Dodo Payments** as the provider. This session ported the same self-verifying-license-key architecture already live on two sibling sites (qrworkbench.com, barcodeflow), simplified to this product's single $99 lifetime tier:

- **No database.** A license key (`PEP-PRO-<dodo_payment_id>`) embeds the real Dodo payment id; "checking access" always means asking Dodo's own API whether that payment succeeded (and, this session's own finding, whether it was since fully refunded — see BUG_FIX_LOG #14), never trusting a client-side flag.
- **Full flow implemented**: hosted checkout (`src/pages/api/checkout/create.ts`) → redirect-back verification (`checkout/verify.ts`) → a real entitlement gate in front of the Pro workspace (`src/components/tools/pro/ProGate.tsx`, wired into `/app`) → manual license-key redemption and forgot-key email recovery for a new device (`src/pages/api/license/{redeem,recover}.ts`) → a webhook (`src/pages/api/webhooks/dodo.ts`, signature-verified via `standardwebhooks`) as a reliability backstop for a closed-tab purchase.
- **Astro adapter added**: `@astrojs/vercel`, with the whole site still statically prerendered — only `src/pages/api/**` opts out per-route (`prerender = false`) to run as real serverless functions.
- **Secrets never reach the client**: verified by grepping the actual built output (`dist/client/`, `.vercel/output/static/`) for the server-only env var names — zero matches (ACCESS-012, `passed`).
- **Refund revocation**: found and fixed during implementation, before any real payment was ever processed against this codebase — Dodo tracks a refund via a separate `refund_status` field, not `payment.status`; both `verify.ts` and `redeem.ts` now check it (ACCESS-010, `passed` by SDK-type inspection).

**What is NOT yet true**: no real Dodo product/API key/webhook secret is configured in this environment (by necessity — those are the user's own dashboard credentials, never something this session could obtain or fabricate), so nothing here has processed a real or even a real *test-mode* transaction. Every route was live-verified to **fail closed correctly** with no credentials configured ("Payments aren't set up yet"), and the pure license-key logic has unit tests, but the actual Dodo API round-trip (checkout session creation, payment retrieval, webhook signature verification against a real signed payload) has not been exercised end-to-end. See `.env.example` for exactly what the user needs to configure (Dodo product + API key + webhook endpoint, and optionally Gmail SMTP credentials for the confirmation email) before this can accept a real charge.

**8 of 12 `ACCESS-*` cases are now `passed` or reasoned `not_run`-with-implementation** rather than uniformly `blocked`; the remaining `not_run` ones need a real Dodo account to exercise. One real, named gap: **ACCESS-007** (a delayed webhook/status update shows a generic message with no automatic re-poll — the user must manually refresh) is `partial`, not fully implemented.

## 7. Remaining risks / launch blockers (historical — see §0.5 above for this session's current backlog)

**Superseded by §0 above**: items 3 (backup conflict UI), 4 (revision switcher), 6 (BACK-015/020), and 7 (TPL-010/011/012) below were all fixed in the v3 continuation session. They are left as originally written for historical accuracy; do not treat them as current.


1. **Payment integration is untested against a real Dodo account** (§6) — this is now an implementation-complete, configuration-blocked item, not an unimplemented one. The user must create the Dodo product, supply real credentials, and this session (or a follow-up one) should run at least one real test-mode purchase before considering paid launch ready.
2. **No automatic retry for a delayed payment-confirmation webhook** (ACCESS-007) — a real, minor UX gap in the payment flow.
3. **Backup restore has no per-conflict resolution UI (BACK-004/005/006/017, mitigated but not fully closed)** — this session found and fixed the worst part (a silent unconditional overwrite on ID collision; now defaults to keep-local, matching spec), but there is still no UI for a user to explicitly choose keep-local/replace/keep-both, and the fix was not re-verified via an actual browser file round-trip.
4. **No revision-switcher UI** — once a project has more than one revision, there is no way to navigate back and view/reprint an earlier issued revision from the UI (its data is provably intact in storage, just not reachable without direct storage inspection).
5. **Multi-tab conflict banner not driven through two real concurrent tabs** — the underlying storage mechanism is proven correct via real transactions; the UI path itself wasn't exercised with two actual browser contexts.
6. **Backup import has no field-level validation on financial data, and no dangling-actual-review-reference check** (BACK-015/020, still failed).
7. **Free estimate template**: no unusual-tax-rate warning, no tax-percentage bounds, no document-level no-charge confirmation for a whole $0.00 estimate (TPL-010/011/012, still failed).
8. **No PDF file was actually generated and text-extracted** — the print CSS mechanism was verified correct, but no headless-PDF tool rendered an actual PDF for content extraction.
9. **187 of 345 catalogued cases remain `not_run`** — see §4. Treat `not_run` as "implemented but individually unverified, per code reading," not as "broken." The 8 cases confirmed `failed` (§4) are the ones known to be genuinely broken or missing; everything else not explicitly named as a gap here is either passing or unverified-but-plausible.

## 8. Verdict

- **Free-tool launch**: ready, with one caveat. All three free tools' core calculation flows work correctly (shared engine's test suite covers the math), and the estimate template's blank-row behavior and the job-cost calculator's missing-vs-zero behavior (bug #12, this session) were both live-verified. The remaining free-tool gaps (TPL-010/011/012/014, INT-013's default counts) are minor polish, not correctness defects.
- **Ready for internal review** (Pro workspace): yes — the core calculation engine, per-surface/standalone-surface estimating, rate refresh, draft/issued isolation, actuals persistence, print output, backup restore's worst failure mode, and now a full Dodo Payments integration are real, tested, and verified (mostly live), including 14 real defects found and fixed with regression evidence this session (17 total across both sessions).
- **Ready for paid launch**: not yet, but the remaining blocker changed character this session — from "no payment code exists at all" to "payment code is implemented and fails safely closed, but has never processed a real transaction." The user needs to: (1) create the Pro product in their Dodo dashboard, (2) supply the credentials in `.env.example` to a real deployment, (3) run at least one real test-mode purchase through the full flow, and (4) decide when to update the homepage's "planned"/"not available yet" copy (left untouched this session — a marketing decision, not a code one). Separately, closing a real conflict-resolution UI for backup restore and the revision-switcher gap would materially reduce risk for early paying customers.

Not deployed, not published, no real charges made or attempted, per the task's explicit instruction.

**This §8 verdict is historical (from before this v3 session's fixes). See `RELEASE_READINESS.md` for the current, separate verdicts on free tools, paid workflows, and payment/access readiness.**
