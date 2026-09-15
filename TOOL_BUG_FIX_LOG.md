# Tool Bug Fix Log — v5 session

Covers the defects investigated and fixed under the current task (item 4's 14
independent-review regressions, minus R01/R02/R14 which are explicitly out of
scope, plus the "starting point, not the entire audit" source findings this
session's own inspection surfaced). Every entry follows: reproduction → root
cause → change → failing-test evidence → passing-test evidence. Prior
sessions' entries (#1–#28) remain in `BUG_FIX_LOG.md` and are not duplicated
here; this file exists specifically for item 10's `TOOL_BUG_FIX_LOG.md`
deliverable and covers only this session's work.

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

## Out of scope, explicitly not touched

**R01, R02, R14** — payment/checkout/domain-recovery behavior. Left as
`it.skip(...)` in `tests/audit/independent-contract.test.ts` with a comment
citing this task's own item-4 exclusion. Never fixed, never deleted, never
counted as passing.
