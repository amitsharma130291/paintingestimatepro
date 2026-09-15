# Tool Bug Fix Log — v5, v6, and v7 sessions

## v7 session, follow-up pass: DECISIONS.md #9 aggregate-output limits (AGG-001..006) + dependency advisories

A follow-up review correctly rejected the 357/357 "complete" state below:
`docs/tdd/DECISIONS.md` item 9 (aggregate-output limits — e.g. a
required price or job cost that overflows practical display/storage
bounds even though every individual field passed its own bound) had
never been promoted to a matrix requirement and was dismissed in this
log's prior entries as "un-built by design choice." That dismissal was
wrong: the item was part of the approved contract independent of matrix
membership. Six new requirement IDs (AGG-001..006) were added, tests
written first, then the policy implemented. Two genuine pre-existing
gaps were found in the process (not just missing coverage):

1. **Suggested-price derivation could silently null out a "complete"
   result.** `assembleProjectEstimate`'s suggested-price path could
   report `calculationState: 'complete'` with `price`/`effectivePrice`
   both `null` whenever `requiredPriceRaw` alone exceeded the
   pre-existing `MAX_REQUIRED_PRICE` ceiling at an extreme (but
   individually valid, `<1`) target margin — even with every other
   aggregate safely under the new cap. This is exactly the
   "disguised-invalid complete state" DECISIONS.md #9 forbids. Found
   only because the review's instruction to test "every calculation
   route that can create an aggregate beyond the supported range" forced
   systematic testing of the price-derivation route, not just the
   cost-summation routes. Fix: `assembleProjectEstimate` now returns a
   structured `outOfSupportedRange: true` invalid result instead.
2. **No upper bound on individual actual-cost review fields.** Actual
   amount, labor hours, and labor rate in the Pro app's actuals form had
   no ceiling at all before this pass. Fix: applied the same
   `MAX_AGGREGATE_MONETARY`/`MAX_AGGREGATE_HOURS`/`MAX_RATE` constants
   already used elsewhere.
3. **`saveActuals` could persist `state: 'final'` while the live
   evaluation was blocked.** It computed "final" from
   `genuinelyCompleteCount === 4` alone, never checking whether
   `evaluateActualReview`'s own result was `'out_of_supported_range'`.
   Fix: added an explicit `actualResult?.state === 'final'` condition.

Implementation: `src/domain/estimateAssembly.ts` (new
`outOfSupportedRange` flag, checked at every aggregation point) and
`src/engine/actuals.ts` (new `'out_of_supported_range'` state).
Evidence: `tests/domain/aggregateLimits.test.ts` (13 cases, written
before the implementation),
`tests/browser/aggregateLimitsDisplay.test.tsx` (real-component render).
Full detail, including the exact ceilings and all ten required
behavioral facets, is recorded directly under DECISIONS.md item 9.

Dependency advisories were reviewed the same pass (`npm audit`: 3 high,
all one CVE — GHSA-9wv6-86v2-598j, ReDoS in `path-to-regexp` — reached
only through `@astrojs/vercel`'s build-time routing-config generation,
never live request handling). Fix: `package.json` `overrides` pinning
`path-to-regexp` to the already-vetted `6.3.0`, resolving all 3 to 0
vulnerabilities with no adapter version change. Full advisory-by-advisory
analysis: `DEPENDENCY_RISK_ASSESSMENT.md`.

## v7 session: closed the entire remaining unverified backlog (114 -> 0 rows) plus 5 named features

All fixes below were developed test-first (RED confirmed before the fix,
GREEN after), matching this file's established discipline. Genuine
implementation gaps found and fixed (as opposed to rows that only needed
a confirming test written against already-correct code):

1. **PRO-013 — rounding reconciliation never wired into the live UI.**
   `reconcileDisplayedComponents` (CALCULATION_SPEC §7) existed and was
   unit-tested in isolation but the Pro estimate summary never called it,
   so independently-rounded Direct cost/Overhead could silently disagree
   by a cent with the displayed Estimated job cost. Fix: call it in the
   summary card, render an explicit "Rounding adjustment" row when
   nonzero. Evidence: `tests/browser/rowReconciliation.test.tsx`.
2. **COST-019 — nonblocking review warnings were entirely unimplemented.**
   CALCULATION_SPEC §1 requires "waste >0.5 and overhead >0.5 produce
   nonblocking review warnings"; the only warnings-shaped type in the
   codebase (`CalculationResult`/`FieldWarning` in `src/engine/types.ts`)
   was dead, unimported scaffolding (confirmed by grep). Fix: real
   `warnings: string[]` on `ProjectEstimateAssembly`, populated for any
   surface's wasteRatio > 0.5 or settings.overheadRatio > 0.5, rendered
   as a nonblocking notice. Evidence: `tests/domain/reviewWarnings.test.ts`,
   `tests/browser/reviewWarnings.test.tsx`.
3. **INT-006 — a $0/hr labor rate was allowed but never warned about.**
   The free interior calculator correctly computed a real $0 labor cost
   at rate=0 (no divisor error), but no warning text existed anywhere in
   the file for this case. Fix: `zeroRateWarning` flag + rendered notice.
   Evidence: `tests/ui/interiorCalculatorRequirements.test.tsx`.
4. **UX-001 — real 360px mobile overflow in the free job-cost calculator.**
   Found via an actual Browser-pane viewport check (not simulated): the
   materials/labor/overhead/pricing mode-toggle button rows used a
   non-wrapping `flex gap-2`, and "Materials: paint + supplies" (233px)
   didn't fit beside its sibling. Fix: `flex-wrap` on all four rows;
   re-verified via `document.documentElement.scrollWidth ===
   clientWidth` in the real browser.
5. **UX-003 — zero screen-reader announcement on any invalid input.**
   None of the four tools' error containers had `aria-live`/`role="alert"`
   — confirmed live in a real browser (0 matches for
   `[aria-live],[role="alert"],[role="status"]` before the fix). Fix:
   `role="alert"` on all four error containers (JobCostCalculator,
   InteriorCalculator, EstimateTemplate, ProApp's estimate summary).
   Evidence: `tests/ui/errorAnnouncement.test.tsx`.
6. **UX-008 — a slow Pro save could silently overwrite newer keystrokes.**
   `saveDraft`/`issueEstimate` captured `draftEdit` in a closure and
   unconditionally overwrote it with the resolved async-save snapshot;
   if the user typed further while that save was in flight, their newer
   edit would be silently discarded once the stale save resolved. Fix:
   capture `updatedAt` at call time, use the functional `setState`
   updater to skip the overwrite when the live draft has moved on.
   Evidence: `tests/browser/uxRaceAndFailureGuidance.test.tsx`.
7. **UX-010 — Pro save failures gave no actionable recovery guidance.**
   The free tool already told a user to export/print before closing on a
   storage failure; Pro's many `setSaveMessage('...failed...')` sites
   never did. Fix: one shared rendering site now appends an "Export
   backup (.json)" pointer whenever the message contains "failed."
   Evidence: `tests/browser/uxRaceAndFailureGuidance.test.tsx`.

Stale evidence corrected (a prior audit's claim did not match current
source; re-verified and re-pointed at real, specific tests rather than
trusted at face value): CAT-007, HEALTH-002, HEALTH-003, HEALTH-005,
HEALTH-006, DOC-003, DOC-005, LIFE-006, LIFE-010, GEO-013, GEO-029,
GEO-030, ACT-014, BACK-008. A data-loss bug in an earlier in-session
matrix-update script (207 of 357 rows silently dropped) was also found
and corrected by restoring from the last commit and reapplying only the
intended row updates on top, with a row-count assertion added to every
subsequent update script.

Five named features completed this session, each with its own
independent-review-grounded requirement: INT-010 (detailed measured
openings in the free interior calculator, quick/detailed mode mutual
exclusivity, lossless free-to-Pro handoff), CAT-008 (explicit
refresh-defaults preview/confirm/cancel for Price Book Health services,
never an automatic silent rewrite), PRO-014 (accessible keyboard-operable
Move up/down room and surface reordering, id-based not index-based),
the business-logo lifecycle (DOC-010/BACK-019/BACK-025 — byte-level
format sniffing, size/dimension limits, no script-capable formats), and
BACK-026 (a written, deterministic engine-version-compatibility policy:
unrecognized future versions are always blocked on draft data, never
silently recalculated; issued/frozen data is exempt by the existing
immutability guarantee).

Final state: `TOOL_REQUIREMENTS_MATRIX.csv` at 357/357 verified, 0
unverified/missing/failed/deferred/decision_required. See
`TOOLS_COMPLETENESS_REPORT.md`'s v7 section for the full final-gates
summary (clean install, typecheck, `verify_reference.py`, build, full
suite x4 with zero flakiness, independent regression suites, and the
`.skip`/`.only`/`.todo` sweep).

---



Covers the defects investigated and fixed under this task across two
sessions: v5 (item 4's 14 independent-review regressions, minus R01/R02/R14
which are explicitly out of scope, plus source findings that session's own
inspection surfaced) and v6 (an independent tools-only review's 11 NEW
regressions against the delivered v5 source, plus completing the paid
costing interface and other item-5/6 gaps). Every entry follows:
reproduction → root cause → change → failing-test evidence → passing-test
evidence. Prior sessions' entries (#1–#28) remain in `BUG_FIX_LOG.md` and
are not duplicated here; this file exists specifically for item 10/12's
`TOOL_BUG_FIX_LOG.md` deliverable.

**v6 session entries are below the v5 section, under "v6 session: independent
tools-only review + paid costing interface completion."**

All fixes below were developed test-first: the cited failing-test evidence
was run against the code as it stood **before** the corresponding commit and
observed to fail (via `git stash` where the fix already existed in the
working tree, or by running the reviewer's own pre-written test against the
unmodified checkout), then the production change was made and the same test
rerun to confirm it passes, then the full suite was rerun for collateral
regressions.

---

## R03 — Replace-all left the business-settings singleton untouched

**Reproduction:** Import a backup in "replace all" mode. The projects/catalog
stores were wiped and replaced, but `businessSettings` was never cleared, so
a stale local settings record silently survived a "full" restore.

**Root cause:** `writeReplaceAllBackup()` in `src/storage/db.ts` never called
`.clear()` on `STORES.businessSettings`.

**Change:** Added the missing `.clear()` call so the singleton is wiped and
replaced along with every other store.

**Failing-test evidence:** `tests/audit/independent-contract.test.ts` — "R03:
replace-all leaves exactly the imported business-settings record" — failed
against the pre-fix `writeReplaceAllBackup`.

**Passing-test evidence:** Same test, green after the fix. Commit `51de860`.

---

## R04 — Replace-all's per-project version field created an ABA hazard

**Reproduction:** Tab A holds a stale draft of project X (version 3). Tab B
does a "replace all" restore that happens to install a *different* project
also carrying `version: 3` in its own exported record. Tab A's next save,
still expecting version 3, could coincidentally match and silently overwrite
the newly-restored, unrelated project.

**Root cause:** Each project's `version` field was a per-record counter
(`(current?.version ?? 0) + 1`), not globally unique, so two completely
different projects could carry the same version number by coincidence.

**Change:** Added a `meta` IndexedDB object store (bumped `DB_VERSION` to 3)
holding one global monotonic counter record. `nextGlobalProjectVersion(tx)`
reads-increments-writes it inside the same transaction as any project write,
and every version-issuing path (`writeProjectWithVersionCheck`,
`writeImportedBackup`, `writeReplaceAllBackup`) now uses it instead of a
per-record counter.

**Failing-test evidence:** `tests/audit/independent-contract.test.ts` — "R04:
replacement cannot roll back a project token and let a stale draft overwrite
the restored project" — failed against the old per-record counter.

**Passing-test evidence:** Same test, green after the fix; also fixed a
self-inflicted regression this introduced in
`tests/browser/proApp.harness.test.tsx`'s two-tab-conflict fixtures (its
`seed()` helper wrote projects via a raw `writeAll` with a hardcoded
`version: 1`, disconnected from the real counter — rerouted through
`writeProjectWithVersionCheck`). Commit `51de860`.

---

## R05 — Keep-both import never remapped service-to-paint references, and dropped provenance

**Reproduction:** Import a backup, hit a conflict on a paint variant, choose
"keep both." The imported project graph's `ServiceDefinition` records still
pointed at the OLD (local) paint variant's ID, not the new copy — a silent
dangling/wrong reference. Separately, a "keep both" project copy in the
merge-import path never returned real import provenance.

**Root cause:** `applyFullRestoreResolutions()` in `src/domain/backup.ts`
tracked new IDs for kept-both *projects* but had no remap table for
kept-both *catalog* records, so `serviceDefinitions[].paintVariantId` was
copied verbatim.

**Change:** Added a `keepBothIdRemap` map populated during the catalog merge,
and a pass over the final service-definition list that rewrites any
`paintVariantId` pointing at a remapped ID. Also threaded through the
keep-both project copy's real provenance instead of discarding it.

**Failing-test evidence:** `tests/audit/independent-contract.test.ts` — "R05:
keep-both remaps an imported service to its imported paint variant" — failed
against the pre-fix merge logic.

**Passing-test evidence:** Same test, plus 2 new tests in
`tests/domain/backup.test.ts` for the remap and provenance-preservation
behavior. Commit `4a091ae`.

---

## R06 — Import accepted malformed or missing frozen customer documents

**Reproduction:** Import a backup where an issued revision's
`customerDocumentSnapshot` was missing entirely, or present but missing
required fields (business info, selling total, status enum, etc.). It was
written to storage as-is.

**Root cause:** No validator inspected the shape of
`customerDocumentSnapshot` at all — only its mere presence/absence for
issued revisions was checked in some paths, and not consistently.

**Change:** Added `validateCustomerDocumentSnapshot()` in
`src/domain/backup.ts`, checking every field the live renderer reads
(estimate number/date, business/customer info, project title/address, scope
lines, proposed price, notes/terms, revision label, tax notice, status
enum), and required it for every issued revision.

**Failing-test evidence:** `tests/audit/independent-contract.test.ts` — "R06:
import rejects an unusable frozen customer document" — failed against the
pre-fix validator.

**Passing-test evidence:** Same test; also had to fix two *pre-existing*
`tests/domain/backup.test.ts` fixtures that marked a revision `'issued'`
without a `customerDocumentSnapshot` (previously accepted, now correctly
rejected by the new validator). Commit `325f74c`.

---

## R07 — Zero-price confirmation only matched the literal string `"0"`

**Reproduction:** Enter a custom price of `0.00` or `0.0` on a job. The
no-charge confirmation gate never triggered because it compared
`revision.proposedPrice === '0'` as a raw string.

**Root cause:** `checkIssueGate()` in `src/domain/project.ts` did a string
equality check instead of parsing the decimal and testing `isZero()`.

**Change:** Parse `proposedPrice` with `parseDecimalField` and gate on
`parsedPrice.value.isZero()`, so `0`, `0.0`, and `0.00` are all treated
identically.

**Failing-test evidence:** `tests/audit/independent-contract.test.ts` — "R07:
the zero-price confirmation gate treats 0.00 as zero" — failed against the
string-equality check.

**Passing-test evidence:** Same test, green after the fix. Commit `d2a295a`.

---

## R08 — Price Book Health displayed one hardcoded example, never real services

**Reproduction:** Open Price Book Health. It showed a single wall-service row
built from `catalog[0]` with a hardcoded null price — never any of the
user's actually-saved `ServiceDefinition` records, prices, or assumptions.

**Root cause:** No UI ever wrote to `STORES.serviceDefinitions`, and the
health tab's render logic never read from it either — it was cosmetic.

**Change:** Added `saveServiceDefinition`/`deleteServiceDefinition` to
`proStore.ts`, a new pure `src/domain/serviceHealthAssembly.ts` mapping real
`ServiceDefinition` records (wall/ceiling/trim/door) to health rows with
proper fallback to global `BusinessSettings` defaults, and full service
CRUD UI (add/edit/remove per kind) wired to real persistence.

**Failing-test evidence:** `tests/audit/independent-ui.test.tsx` — "R08:
Price Book Health displays saved service definitions and their selling
prices" — failed (the UI never rendered a persisted service at all).

**Passing-test evidence:** Same test, plus 14 new unit tests in
`tests/domain/serviceHealthAssembly.test.ts` with hand-derived expected
values per surface kind. Commit `a9c7643`.

---

## R09/R10 — Actual-cost input crashed on invalid text; finality ignored real validity

**Reproduction (R09):** Type non-numeric text (`"abc"`) into an actual-cost
amount field. The app threw, because the raw text was fed directly into
`new PEP(...)`.

**Reproduction (R10):** Check all four "confirmed" boxes in the actuals tab
without entering any amounts, then save. The review was persisted as
`state: 'final'` — a completed review with zero recorded costs.

**Root cause:** Amount parsing had no validation gate before constructing a
`Decimal`, and finality was derived from `Object.values(actuals).filter(c =>
c.confirmed).length === 4` — the checkbox count alone, ignoring whether the
amount was actually a valid, non-null value.

**Change:** Added `deriveActualCategory()`, a single crash-proof parse (via
`parseDecimalField`) shared by both the live on-screen preview and the save
path, so the two can never disagree. Finality now requires
`confirmed && value !== null` for all four categories.

**Failing-test evidence:** `tests/audit/independent-ui.test.tsx` — "R09:
entering nonnumeric actual cost does not crash the application" and "R10:
confirming four blank cost categories must not persist a final review" —
both failed against the pre-fix code (R09 threw; R10 persisted `state:
'final'`).

**Passing-test evidence:** Both tests green after the fix. Commit `6962306`.

---

## R11 — Import-as-copies used the source project's stale version, not the committed one

**Reproduction:** Import a project as a copy from a backup where the source
carried `version: 7`. The newly-created local copy inherited `version: 7` in
React state even though the actual commit inside `writeImportedBackup`
correctly re-stamped it from the global counter — so the very next save on
that copy failed with a spurious version conflict.

**Root cause:** `confirmImport()`'s "copies" branch in `ProApp.tsx` set local
state from the pre-write project objects, never from
`writeImportedBackup`'s own return value.

**Change:** `saveImportedBackup`/`writeImportedBackup` already returned
`committedProjectVersions`; wired that return value into the copies branch's
`setProjects()` call.

**Failing-test evidence:** `tests/audit/independent-ui.test.tsx` — "R11: a
copied project from version 7 can be edited and saved immediately" — failed
(the immediate edit-and-save conflicted) against the pre-fix code.

**Passing-test evidence:** Same test, green after the fix. Commit `d506df5`.

---

## R12 — Backup export used stale in-memory state, not committed storage

**Reproduction:** Open the app in tab A. In tab B, save a new project. In tab
A (never having reloaded), click "Export backup." The export omitted tab B's
project entirely.

**Root cause:** `handleExport()` built the envelope from React component
state (`settings`, `catalog`, `projects`), only otherMaterials/
serviceDefinitions/importProvenance came from a fresh `loadSnapshot()`.

**Change:** `handleExport()` now calls `loadSnapshot()` for every collection
before building the export envelope, so it always reflects the actually
committed data, including changes from another tab.

**Failing-test evidence:** `tests/audit/independent-ui.test.tsx` — "R12:
export includes a project committed by another tab after this tab loaded" —
failed against the stale-state export.

**Passing-test evidence:** Same test, green after the fix. Commit `543b969`.

---

## R13 — Issuing an estimate never froze its calculated outputs

**Reproduction:** Issue a valid estimate. `rawCalculatedOutputs` stayed
`null` forever — it was initialized to `null` and never written anywhere —
so every later actual-cost comparison silently fell back to a LIVE
recomputation against whatever the engine produces *today*, not the
historical baseline the estimate was actually issued under.

**Root cause:** No code path ever called anything to populate
`rawCalculatedOutputs`.

**Change:** Added `src/domain/calculationSnapshot.ts`
(`freezeCalculatedOutputs`/`readFrozenCalculatedOutputs`) — a versioned,
engine-versioned snapshot of job cost, materials, labor, direct cost,
overhead, effective price, profit, and margin ratio, stored as canonical
decimal strings. Wired into `issueEstimate()`. Also wired the
previously-implemented-but-never-called `supersede()` domain helper into the
same function, so issuing a new revision correctly marks any prior issued
revision as `'superseded'`. `actualResult`'s baseline derivation now prefers
the frozen snapshot, falling back to a disclosed live recompute only for
pre-fix issued revisions.

**Failing-test evidence:** `tests/audit/independent-ui.test.tsx` — "R13:
issuing a valid estimate persists its calculated outputs" — failed (asserted
`rawCalculatedOutputs` non-null) against the pre-fix code.

**Passing-test evidence:** Same test, plus 7 new unit tests in
`tests/domain/calculationSnapshot.test.ts`. Commit `dd18590`.

---

## ACT-010 (source-confirmed finding) — Actual-cost overhead never supported the spec's required "baseline allocation" mode

**Reproduction:** Record an actual-cost review. The overhead category was
always a free-text box saved as `mode: 'actualFlat'` — there was no way to
say "I'm just accepting the estimate's own overhead allocation as my
actual," which `DATA_CONTRACT.md` explicitly requires as one of two modes
(`baselineAllocation` | `actualFlat`).

**Root cause:** The entity type already defined the dual mode, but
`ProApp.tsx`'s actuals UI never exposed a mode choice and hardcoded
`mode: 'actualFlat'` on every save.

**Change:** Extended `readFrozenCalculatedOutputs` to also expose the frozen
overhead value. Added an `overheadMode` toggle to the actuals tab, defaulting
to `baselineAllocation` (per the spec's own labeling), which auto-populates
and locks the amount field to the baseline's own overhead; switching to
"Enter actual amount" allows free entry. The chosen mode is persisted and
restored on reopen.

**Failing-test evidence:** `tests/browser/actualsOverheadMode.test.tsx` — all
5 tests — failed against the pre-fix code (no radio toggle existed at all).

**Passing-test evidence:** All 5 tests green after the fix, plus 1 new unit
test in `tests/domain/calculationSnapshot.test.ts` for the extended overhead
round-trip. Commit `f784ebe`.

---

## INT-008/009/014 (source-confirmed findings) — Free interior calculator missing two specified inputs

**Reproduction:** `tool-specs/03` requires `includeWalls default true;
includeCeiling default false; at least one enabled` and "Additional
prep/cleanup hours>=0 default0, clearly shown." Neither existed: walls were
unconditionally force-enabled (no ceiling-only mode possible), and there was
no prep/cleanup hours input anywhere in the labor section.

**Root cause:** Both inputs were simply never built.

**Change:** Added an "Include walls" checkbox (default checked) with the
spec's "at least one enabled" validation; wall geometry, opening deductions,
and wall labor throughput are now only computed/shown when walls are
enabled. Added a "Prep/cleanup hours" field (default 0, validated
zero-or-positive) that adds directly to summed production hours before the
loaded rate is applied. Also fixed a related bug this surfaced in
`buildProjectFromInteriorHandoff` — it built the ceiling surface by spreading
the wall surface object, so once the wall could be disabled the ceiling
silently inherited `enabled: false` too.

**Failing-test evidence:** `tests/ui/interiorCalculator.test.tsx` — all 8
tests — failed against the pre-fix component (no includeWalls toggle or prep
hours field existed).

**Passing-test evidence:** All 8 tests green after the fix, plus 2 new tests
in `tests/domain/interiorHandoff.test.ts` for the disabled-wall handoff
regression. Commit `90a730f`.

---

## LIFE-003 (source-confirmed finding) — Rate refresh had no recoverable pre-refresh snapshot

**Reproduction:** `DATA_CONTRACT.md` #3 requires "Confirm before applying.
Keep a recoverable pre-refresh draft snapshot." Confirming a rate refresh
overwrote `draftEdit` with the refreshed result and discarded the only
reference to the pre-refresh draft — there was no way back except an unsaved
page reload, useless after the very next save.

**Root cause:** `applyRateRefresh()` itself was already pure/non-destructive,
but the caller (`confirmRateRefresh()` in `ProApp.tsx`) never retained the
pre-refresh object.

**Change:** Added a `preRefreshSnapshot` state captured at the moment of
confirm, an "Undo refresh" button that restores it exactly, and cleared it on
save or on leaving the project.

**Failing-test evidence:** `tests/browser/rateRefreshUndo.test.tsx` — both
tests — confirmed failing against the pre-fix code via `git stash` (no "Undo
refresh" control existed).

**Passing-test evidence:** Both tests green after the fix. Commit `bd1a9d5`.

---

## Out of scope, explicitly not touched (v5 session)

**R01, R02, R14** — payment/checkout/domain-recovery behavior. Left as
`it.skip(...)` in `tests/audit/independent-contract.test.ts` with a comment
citing this task's own item-4 exclusion. Never fixed, never deleted, never
counted as passing.

---

# v6 session: independent tools-only review + paid costing interface completion

A second independent review (`painting-estimate-pro-v5-tools-review.zip`)
reproduced 11 new regressions against the delivered v5 source
(`tests/review-v5/`), and separately identified that the main Pro project
editor exposed no way to enter additional labor, itemized materials, a
supplies allowance, or direct expenses/travel — a core completeness gap
beyond the shorter missing-feature list in the v5 completeness report. It
also caught an evidence-accuracy error: v5's LIFE-003 was marked "verified"
based on a test that actually proved the WRONG (in-memory-only) behavior.

## V5-01 — 100% target margin crashes service-health calculation

**Reproduction:** A saved wall service with `targetMarginRatio: "1"` (or any
value outside 0 ≤ m < 1). `assembleServiceHealth` calls the pricing
engine's `requiredPriceRaw()`, which throws `targetMarginRatio out of
range` rather than returning a structured result.

**Root cause:** Neither `assembleServiceHealth` nor `assembleProjectEstimate`
validated the range before calling the pricing engine — only the free
job-cost calculator already had this guard.

**Change:** Both assemblies now check `targetMarginRatio.greaterThanOrEqualTo(1)
|| .isNegative()` and return a structured `invalid` result before ever
calling `requiredPriceRaw`.

**Failing/passing-test evidence:** `tests/review-v5/tools-contract.test.ts`
V5-01; extended boundary coverage (exactly 100%, just above/below, negative,
exactly 0%) in `tests/domain/serviceHealthAssembly.test.ts` and
`tests/domain/estimateAssembly.test.ts`. Commit `57dcb7a`.

## V5-02 — keep-both rewrites local services to the imported paint

**Reproduction:** Local paint `paint-1` ($42) with a local service
referencing it; incoming backup has a conflicting $99 paint plus its own new
service. Choosing "keep both" for the paint remapped the LOCAL service's
`paintVariantId` to the new copy too, even though the local paint variant
itself was untouched.

**Root cause:** `applyFullRestoreResolutions`'s keep-both remap applied to
every final service definition sharing the remapped ID string, without
distinguishing local-preserved content from incoming-origin content.

**Change:** Tracks a `localPreservedIds` set (local, non-conflicting records,
and local records whose OWN conflict resolved to keepLocal/keepBoth) and
excludes them from the remap entirely; only incoming-origin content
(new/replaced/keepBoth-copy) is ever remapped.

**Failing/passing-test evidence:** `tests/review-v5/tools-contract.test.ts`
V5-02; extended coverage for local+incoming service combinations and for
keepLocal/replaceImported (which never mint a copy to remap toward) in
`tests/domain/backup.test.ts`. Commit `57dcb7a`.

## V5-03 — v2-to-v3 database upgrade reuses project versions

**Reproduction:** A real pre-v3 IndexedDB database with an existing project
at version 1. Upgrading via `openAppDb` creates an empty `meta` store, so
the new global counter restarts at 0 — the first post-upgrade save reissues
version 1, and a second, genuinely stale save (also expecting version 1)
incorrectly succeeds instead of conflicting.

**Root cause:** The upgrade never seeded the counter relative to versions
already present under the old per-project scheme.

**Change:** On a v2→v3 upgrade with an existing `projects` store, the
upgrade reads every existing project's version and seeds the counter to the
maximum found, before any new write can read it.

**Failing/passing-test evidence:** `tests/review-v5/tools-contract.test.ts`
V5-03; extended to several pre-existing projects at different legacy
versions, plus normal saves and import writes post-upgrade, in the new
`tests/storage/dbUpgrade.test.ts`. Commit `57dcb7a`.

## V5-04 — a legitimate revised project produces a rejected backup

**Reproduction:** Issue revision 1, record a final actual review against it,
issue revision 2 (superseding revision 1 via the production `supersede()`
helper). Exporting now fails validation, even though it validated fine
before the second issue.

**Root cause:** `validateActualReview` required the baseline's state to be
exactly `'issued'`, rejecting the valid historical `'superseded'` state.

**Change:** Accepts a baseline that is `'issued'` OR `'superseded'`, still
rejecting `'draft'`.

**Failing/passing-test evidence:** `tests/review-v5/tools-contract.test.ts`
V5-04. Commit `57dcb7a`.

## V5-05 — the configured supplies default is omitted from calculated cost

**Reproduction:** Configure a $50 flat supplies default; create a new draft
with a 400 ft² wall. Materials come out to $126 (paint only) instead of
$176 (paint + the configured allowance).

**Root cause:** `createDraftRevision` hardcoded
`suppliesAllowance: {mode:'none', amount:'0', ratio:'0'}` regardless of the
configured `defaultSuppliesAllowance`, and never inserted a travel expense
line from `defaultTravelAmount` either (the same root cause as CAT-010/
COST-014/015).

**Change:** `createDraftRevision` now reads both defaults from the
snapshot's own captured `businessSettings`.

**Failing/passing-test evidence:** `tests/review-v5/tools-contract.test.ts`
V5-05; none/flat/paintPercent supplies modes and travel-line duplication
checks in the new `tests/domain/createDraftRevision.test.ts`. Commit
`57dcb7a`.

## V5-06 — the frozen-output reader accepts NaN as historical cost

**Reproduction:** `readFrozenCalculatedOutputs({schemaVersion:1,
engineVersion:"2.1.0", jobCost:"NaN", overhead:"0"})` reports
`status:"frozen"`.

**Root cause:** `new PEP('NaN')` / `new PEP('Infinity')` do not throw in
decimal.js — the existing try/catch guard caught nothing. The import
validator also never checked `rawCalculatedOutputs` at all.

**Change:** Added a finiteness + sign check applied to every field in the
frozen structure (cost/price fields non-negative; profit/margin may be
negative). Wired the same check into `validateBackupEnvelope` so a
present-but-corrupted structure is rejected on import too (null/absent is
still accepted — normal for a draft or a pre-freeze issued revision).

**Failing/passing-test evidence:** `tests/review-v5/tools-contract.test.ts`
V5-06; NaN/Infinity/negative-cost/non-string rejection and negative-
profit/margin acceptance in `tests/domain/calculationSnapshot.test.ts`;
import-level rejection/acceptance in `tests/domain/backup.test.ts`. Commit
`733e687`.

## V5-07 — a three-decimal selling total is accepted as complete

**Reproduction:** A custom selling total of `12.005` is accepted as
`complete` in both the Pro estimate summary and the free job-cost
calculator.

**Root cause:** Neither `parseDecimalField` call for these fields passed
`maxFractionDigits: 2` — both used the general 10-digit text-entry limit.

**Change:** Both now pass `maxFractionDigits: 2`, per CALCULATION_SPEC.md
§6's "at most two decimal places" rule (CORE-021).

**Failing/passing-test evidence:** `tests/review-v5/tools-contract.test.ts`
V5-07; boundary coverage (3/4 digits rejected, exactly 2 and whole-dollar
accepted) in `tests/domain/estimateAssembly.test.ts` and
`tests/ui/jobCostCalculatorLogic.test.ts`. Commit `01b0cfa`.

## V5-08 — pre-refresh recovery disappears on save/reopen

**Reproduction:** Refresh a draft's rates, save, reopen (full remount) — the
"Undo refresh" recovery point is gone.

**Root cause:** The prior session's fix stored the pre-refresh snapshot as
plain `useState` in `ProApp`, and `saveDraft()` explicitly cleared it. The
prior session's OWN test asserted this disappearance as desired behavior —
verifying the bug instead of DATA_CONTRACT.md #3's actual "keep a
recoverable pre-refresh draft snapshot" requirement.

**Change:** Moved the checkpoint into the data model: `EstimateRevision`
gains an optional `preRefreshCheckpoint` field, populated by
`applyRateRefresh()` with the pre-refresh revision (its own checkpoint
stripped, so repeated refreshes replace rather than nest). Being a normal
field, it now persists through the existing save path automatically. A new
pure `undoRateRefresh()` domain helper restores it exactly.

**Failing/passing-test evidence:** `tests/review-v5/tools-workflows.test.tsx`
V5-08; checkpoint capture/undo/no-checkpoint/repeated-refresh-replaces in
`tests/domain/rateRefresh.test.ts`; rewrote the prior session's own
`tests/browser/rateRefreshUndo.test.tsx` test that had the wrong assertion,
now verifying survival through save AND a full unmount/remount/reopen.
Commit `73093b6`.

## V5-09 — newly added prep hours disappear in the free-to-Pro handoff

**Reproduction:** Enter 3 prep/cleanup hours in the free interior
calculator, click "Continue this room in Pro" — the built Pro revision has
no additional labor and no disclosure note mentioning the hours.

**Root cause:** `InteriorHandoffPayload` had no `prepHours` field at all;
the existing "labor rate not transferred" note doesn't explain losing the
entered hours themselves.

**Change:** The payload carries `prepHours`; `buildProjectFromInteriorHandoff`
preserves it as a named additionalLabor line costed at the DESTINATION
business's own loaded rate, or explicitly discloses the omission when no
rate is configured yet.

**Failing/passing-test evidence:** `tests/review-v5/tools-workflows.test.tsx`
V5-09; preserved-with-correct-rate, contributes real cost through the full
assembly pipeline, disclosed-when-no-rate, and blank/zero-adds-nothing in
`tests/domain/interiorHandoff.test.ts`. Commit `779176e`.

## V5-10 — a new trim service invents four feet of developed width

**Reproduction:** Clicking "+ trim service" pre-fills `Developed width (ft)`
with `4`; a new door service similarly gets an assumed 3×6.67 two-sided
door.

**Root cause:** `addService()` hardcoded these "sample" geometry values
instead of leaving them unset.

**Change:** Every required geometry field on a new service now starts
`null`, matching every other required-with-no-default field in the app.

**Failing/passing-test evidence:** `tests/review-v5/tools-workflows.test.tsx`
V5-10; extended to the door kind (the review's own test only covered trim)
in the new `tests/browser/addServiceNoInventedGeometry.test.tsx`. Commit
`3588bdc`.

## V5-11 — baseline overhead rejects the app's own calculated precision

**Reproduction:** Set wall throughput to 137 ft²/hr/coat (an ordinary,
editable rate), issue a 10×10×8 room, open actual review — "Save actuals"
is disabled because the baseline overhead's computed string exceeds 10
fractional digits.

**Root cause:** `deriveActualCategory` fed the baselineAllocation overhead
value through `parseDecimalField`, the same parser that enforces a
10-fractional-digit TEXT-ENTRY limit meant to catch human mistakes — not
appropriate for the app's own internal, fully-precise calculation result.

**Change:** Added `baselineOverheadValue()` returning the `Dec` directly and
a dedicated `deriveOverheadCategory()` that uses it as-is in
baselineAllocation mode, never round-tripped through the text parser.

**Failing/passing-test evidence:** `tests/review-v5/tools-workflows.test.tsx`
V5-11; discovered that the PRIOR session's own ACT-010 tests (wallThroughput
150, overheadRatio 0.15) happened to cancel out to a clean 2-decimal result
by numeric coincidence and never actually exercised this bug — added a new
regression using the review's own deliberately non-round 137 ft²/hr/coat
rate in `tests/browser/actualsOverheadMode.test.tsx`. Commit `faf48d1`.

## Completing the paid costing interface (item 5)

**Reproduction (completeness gap, not a single failing test):** The main
Pro project editor exposed no way to enter additional-labor lines, itemized
other materials, a supplies allowance, or direct-expense/travel inputs —
`assembleProjectEstimate` already fully consumed
`revision.additionalLabor`/`otherMaterialLines`/`suppliesAllowance`/
`otherExpenses`, but no interface control ever wrote to any of them.

**Change:** Added a real "Additional costs" section to the project editor
with add/edit/remove UI for all four: named additional-labor tasks (hours +
rate), itemized other materials (description/unit/quantity/unit cost), the
supplies-allowance mode selector (now actually editable), and named other
direct expenses (including the travel line a configured default already
seeds).

**Genuine crash found while building the completion test:**
`assembleProjectEstimate` constructed `new PEP(rawString)` directly from
these four line-item arrays' raw text with zero validation — a freshly-added
blank line (the normal state the instant "+ Add task"/"+ Add
material"/"+ Add expense" is clicked, before the customer finishes typing
every field) threw a `DecimalError` and crashed the whole estimate summary.
Fixed by validating every field through `parseDecimalField` first (missing
→ incomplete, malformed → invalid), exactly like every other user-entered
field in this assembly.

**Failing/passing-test evidence:** `tests/browser/projectCostEntry.test.tsx`
drives the independent review's own "Required completion test" verbatim
through the real interface (empty project → named prep task, itemized
material, allowance, travel expense → independently-derived cost/overhead/
price → save → reopen → issue → restored results), confirmed failing (no
such UI existed, then a real crash) against the pre-fix component, passing
after. 9 new domain-level tests in `tests/domain/estimateAssembly.test.ts`
cover blank/malformed/valid states for all four line-item kinds. Commit
`41f7122`.

## Pro room editor: quick/detailed opening entry (item 6)

**Reproduction (completeness gap):** `estimateAssembly.ts`'s
`resolveSurface` already fully supported `Room.openingMode: 'detailed'` and
`Room.openings[]`, correctly computing net area from measured width × height
× count — but the real Pro room editor never exposed a way to reach it,
identical in spirit to the free calculator's own INT-010 gap, just in the
paid tool.

**Change:** Added an "Opening entry" mode selector (shown once "Deduct
openings" is enabled) and, in detailed mode, a real add/edit/remove list of
measured openings, superseding the quick 20/15 ft² constants.

**Failing/passing-test evidence:** `tests/browser/detailedOpenings.test.tsx`,
confirmed failing (no such controls existed) against the pre-fix component,
passing after — independently-derived Materials cost for both the quick-
mode default (5 gal → $210.00) and the detailed-mode measured opening (4
gal → $168.00), confirming the measured dimensions drive the calculation.
Commit `37c2e15`.

## Actual labor as hours × rate (ACT-011, item 6)

**Reproduction (completeness gap):** `ActualReview.laborBreakdown` was
defined in the domain model and validated on import, but no UI ever exposed
the `hoursRate` mode — actual labor could only ever be entered as one flat
dollar amount.

**Change:** Added a labor-mode toggle mirroring the existing overhead
dual-mode pattern (ACT-010): "Enter amount directly" or "Hours × rate",
using one authoritative active mode with no blending from the inactive
mode's fields.

**Failing/passing-test evidence:** `tests/browser/actualsLaborBreakdown.test.tsx`,
confirmed failing (no such toggle existed) against the pre-fix component,
passing after — covers default mode, live computation, persistence,
restore-on-reopen, and incomplete-entry safety. Commit `55ef334`.

## Out of scope, explicitly not touched (v6 session)

Same exclusions as v5: payment/checkout/domain/licensing/authentication/
deployment/infrastructure. No new payment-adjacent findings this session.
