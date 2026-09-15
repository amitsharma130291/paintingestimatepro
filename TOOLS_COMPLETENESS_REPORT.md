# Tools Completeness Report — v7 session (supersedes the v6 report below)

## Current status: 357/357 in-scope requirements verified

`TOOL_REQUIREMENTS_MATRIX.csv` now shows **357 verified, 0 unverified, 0
missing, 0 failed, 0 deferred, 0 decision_required** — every in-scope row
(CORE, GEO, COST, TPL, JOB, INT, CAT, PRO, HEALTH, DOC, ACT, LIFE, BACK,
UX, BOUND) carries a real implementation location, a specific automated
test reference, and evidence describing exactly what that test proves.
Three tests remain individually `.skip`'d (`tests/audit/independent-
contract.test.ts` R01, R02, R14) — confirmed by direct reading to concern
payment/checkout retry and purchaser-domain recovery, both explicitly
out of scope for this tools-only contract. No other `.skip`, `.only`,
`.todo`, `xit`, or `xdescribe` exists anywhere in the test tree (repo-wide
grep, zero matches).

This session's work, on top of the v6 state below (which itself already
closed 6 confirmed defects): resolved 5 named features (INT-010 detailed
openings, CAT-008 explicit refresh-defaults confirmation, PRO-014
accessible room/surface reordering, the full logo lifecycle across
DOC-010/BACK-019/BACK-025, and BACK-026's engine-version-compatibility
policy), then worked through the entire remaining backlog of unverified
rows one requirement at a time. That sweep found and fixed several
genuine implementation gaps beyond missing tests:

- **PRO-013**: `reconcileDisplayedComponents` (the rounding-reconciliation
  primitive) was implemented and unit-tested in isolation but never wired
  into the live Pro estimate summary — independently-rounded Direct
  cost/Overhead rows could silently disagree by a cent with the displayed
  Estimated job cost. Now surfaced as an explicit "Rounding adjustment"
  row whenever it happens.
- **COST-019 / CALCULATION_SPEC §1**: "waste >0.5 and overhead >0.5
  produce nonblocking review warnings" was specified but never
  implemented anywhere (the only warnings-shaped type in the codebase was
  dead, unused scaffolding). Added real warning collection to
  `assembleProjectEstimate` and a nonblocking notice in the Pro summary.
- **INT-006**: the free interior calculator allowed a $0/hr labor rate
  (correctly, per spec) but never showed the required warning for it.
  Added.
- **UX-001**: a real 360px mobile viewport check (Browser pane, not
  simulated) found the free job-cost calculator's mode-toggle buttons
  overflowing horizontally. Fixed with `flex-wrap`.
- **UX-003**: none of the four tools' error containers had any
  `aria-live`/`role="alert"` — confirmed live in a real browser (0
  matches). A screen-reader user got no announcement on an invalid entry.
  Fixed across all four tools.
- **UX-008**: `saveDraft`/`issueEstimate` in the Pro app could silently
  overwrite a user's newer keystrokes with a stale async save result if
  the user kept typing while a save was in flight. Fixed with a
  staleness guard on the resolved-state update.
- **UX-010**: Pro's save-failure messages never included the free tool's
  existing export-backup guidance. Added.

Several other rows turned out to be **stale evidence, not real gaps**:
prior audits had cited test files that actually exercised a different
scenario entirely (HEALTH-002/003, DOC-003/005), or claimed a bug that a
later session had already fixed without updating the ledger (LIFE-006,
LIFE-010, CAT-007). Each of these was re-verified against current source
and given a real, specific confirming test rather than trusted at face
value.

Real-browser verification (required, not optional, per this session's
contract) was performed via an isolated dev-only harness
(`src/pages/dev/pro-harness.astro`) that mounts the real `ProApp`
component with synthetic local data — it 404s in a production build
(`import.meta.env.PROD` guard, confirmed by inspecting the actual built
output) and imports no payment/auth code, so it never touches or
bypasses the real payment gate. Using it: confirmed zero horizontal
overflow at 360px across every tool, confirmed real keyboard Tab
navigation produces a genuine visible `:focus-visible` outline with no
trap across a full cycle, confirmed the compiled `@media print`
stylesheet is real (not just a class name with no matching rule), and
confirmed an 8-room + trim + door issued project's customer document
renders every line with nothing clipped or truncated.

Final gates run this session, all clean: `npm ci` (clean install, 481
packages, 0 install-time errors — `npm audit` separately reports 3 high-
severity advisories in a transitive Vercel-adapter build dependency,
`path-to-regexp` via `@vercel/routing-utils`; fixing it requires a
breaking `@astrojs/vercel` major-version bump, left as a known,
separately-actionable item rather than an unauthorized breaking change),
`npm run check` (0 errors), `python3 docs/verify_reference.py` (20
fixtures / 106 fields, all PASS), `npm run build` (clean production
build), and the full test suite — 84 files / 820 tests / 3 pre-approved
skips, run four times total (once serial, three times in default
parallel mode) with **zero failures in any run**, closing out this
session's required rigorous (not dismissive) flakiness investigation:
the previously-documented "intermittent timeout under high parallelism"
is architecturally explained (`fake-indexeddb` is isolated per test-file
worker, no cross-file shared state) and did not reproduce in four
consecutive full runs.

Two end-to-end workflow tests were added as required deliverables in
their own right, not just matrix-row evidence:
`tests/integration/freeToProWorkflow.test.tsx` (build a room in the free
calculator, hand it off, decline once, accept, verify exact data
parity, price and save it in Pro) and
`tests/integration/proEstimateLifecycle.test.tsx` (new project -> save
-> issue -> edit -> reorder -> rate refresh -> undo -> partial actuals
-> export backup, one continuous session).

One item remains a deliberately documented simplification, not a matrix
gap: `IMPLEMENTATION_DECISIONS.md` item 9 ("aggregate/display limits
beyond individual field bounds," e.g. summing 2,000 surfaces' costs
against a project-level display-range cap) was never promoted to a
numbered requirement in `TOOL_REQUIREMENTS_MATRIX.csv` and remains
un-built by original design choice ("building an untested guess felt
worse than leaving it as a named gap") — flagged here for visibility,
not newly discovered.

---

# Tools Completeness Report — v6 session (supersedes the v5 report)

Scope: every free and paid tool in the approved specs (`docs/tool-specs/`),
calculation correctness, input validation, output completeness, and reliable
handling of customer work. **Excludes**, per this task's explicit scope:
payment integration, checkout, licensing, authentication, domains, SEO,
homepage/marketing, deployment, infrastructure.

This report is derived from `TOOL_REQUIREMENTS_MATRIX.csv` (357 in-scope
requirements: 333 drawn directly from `docs/tdd/test-cases.csv` against the
approved specs, plus the 11 in-scope independent-review-v4 regressions
R03–R13, plus 13 rows added this session for the independent-review-v5
regressions V5-01–V5-11 and two source-confirmed findings). Status counts:
**182 verified**, **128 unverified** (behavior likely present but not yet
proven by a dedicated automated test), **47 missing** (confirmed absent by
source inspection). Full breakdown by area is in the matrix CSV; this
report gives a per-tool verdict and names the concrete gaps, not a
percentage score.

**This session's independent tools-only review reproduced 11 new
regressions (V5-01 through V5-11) against the delivered v5 source, and
separately identified that the main Pro project editor exposed no way to
enter additional-labor, itemized-material, supplies-allowance, or
direct-expense/travel inputs — a completeness gap beyond the v5 report's
own list. It also caught an evidence-accuracy error in the v5 report
itself: LIFE-003 was marked "verified" against a test that had asserted
the WRONG (in-memory-only) recovery behavior as desired.** All 11
regressions are now fixed, the costing-interface gap is closed, and the
v5 report's LIFE-003 claim is corrected below. Full detail on every fix is
in `TOOL_BUG_FIX_LOG.md`'s "v6 session" section.

No tool below is claimed "10/10" or "bug-free." Every verdict states what a
painter can rely on today and what still needs work.

---

## Free tools

### 1. Free manual estimate template (`tool-specs/01`)
**Verdict: mostly verified, core arithmetic solid.**
Cent-rounded line totals, tax-on-rounded-subtotal, untouched-vs-incomplete
row distinction, zero-total no-charge confirmation, and duplicate
independence are all verified by `tests/ui/estimateTemplateLogic.test.ts`
and `tests/engine/document.test.ts`. Draft storage failure handling
(quota/corruption) is verified by `tests/ui/estimateTemplateStorage.test.ts`
(fixed this multi-session project's BUG_FIX_LOG #27). Remaining
**unverified** (17 total, 6 verified, 11 unverified, 0 confirmed-missing):
print/PDF pagination and multi-page rendering with long descriptions
(P02), and a few less-central validation paths lack a dedicated automated
test even though the underlying logic looks correct on inspection. No
known defects.

### 2. Free job-cost calculator (`tool-specs/02`)
**Verdict: verified for its core calculation, some validation paths unverified.**
The original-brief fixture, mode-switching without stale blends
(materials/labor/overhead), missing-vs-zero-cost distinction, and reverse
pricing (unpriced/zero-price/below-cost) are all verified in
`tests/ui/jobCostCalculatorLogic.test.ts`. 9/15 verified, 6 unverified, 0
missing — the unverified items are mostly edge-case combinations (e.g.
specific overhead-mode/pricing-mode cross-products) not yet given their own
test, not known defects.

### 3. Free single-room interior calculator (`tool-specs/03`)
**Verdict: two real gaps fixed in a prior session; the free-to-Pro handoff gap fixed this session; one gap remains.**
**Fixed in a prior session:** an `includeWalls` toggle (walls were always
force-enabled, making a ceiling-only room impossible) and a prep/cleanup
hours field (INT-008/009/014). **Fixed this session (V5-09):** the entered
prep hours were being silently dropped in the "Continue this room in Pro"
handoff — now preserved as a named additional-labor line at the
destination business's own rate, or explicitly disclosed as omitted.
**Genuinely browser-tested this session** (see "Automated vs. browser
results" below): loading the sample fixture, toggling walls/ceiling on and
off, and entering prep hours all produced the independently-derived
numbers in an actual browser tab, not just jsdom. **Remaining gap
(INT-010, confirmed missing):** the spec's `openingMode quick|detailed`
switch does not exist for this FREE tool — only the quick 20/15 ft² preset
is implemented; there is no way to enter measured door/window dimensions.
(The PAID Pro tool's equivalent gap was found and fixed this session — see
"Room and surface entry" below — but the free tool's own quick/detailed
switch was not in scope for that fix and remains open.) This is a real
accuracy limitation for irregular openings, not a crash or data-loss risk.
9/15 verified, 5 unverified, 1 missing (INT-010).

---

## Paid (Pro) tools

### 4. Business settings and catalog (`tool-specs/04`)
**Verdict: substantially complete; one prior-session evidence error corrected, one gap remains.**
Rate-refresh preview/confirm/cancel, live-vs-snapshot isolation, and
deleted-variant handling (retain/replace) are all verified through
`tests/domain/rateRefresh.test.ts` and `tests/integration/draftIssuedIsolation.test.ts`.
**Correction (LIFE-003):** the prior session's report marked LIFE-003
"verified," but the independent review correctly caught that its own test
had asserted the pre-refresh recovery point should DISAPPEAR after saving
— the opposite of DATA_CONTRACT.md #3's actual requirement, and a
mismatch the prior session should have caught itself. This session moved
the recovery point into the data model (`EstimateRevision.preRefreshCheckpoint`)
so it genuinely survives save and reopen, and rewrote the incorrect test.
LIFE-003 is now verified against the corrected behavior — see
`TOOL_BUG_FIX_LOG.md` V5-08 for the full account. **Fixed this session
(V5-05/CAT-010):** a configured supplies-allowance or travel default was
being silently omitted from every new draft's cost — `createDraftRevision`
now applies both from the snapshot's own captured settings. **Confirmed
remaining gap:** CAT-008 (no interactive UI for "refresh service defaults"
preview/confirm on service assumptions — settings drift silently applies
to services, unlike the project catalog). 10/14 verified, 3 unverified, 1
missing.

### 5. Room and surface entry (`tool-specs/05`)
**Verdict: a real completeness gap found and fixed this session.**
Stable IDs surviving reorder/rename, disabled-surface exclusion, and
standalone trim/door surfaces (no room required) are verified in
`tests/engine/estimate.test.ts` and `tests/domain/estimateAssembly.test.ts`.
**Fixed this session:** the domain layer already fully supported measured
(`detailed`) opening entry — correctly computing net area from width ×
height × count instead of the quick 20/15 ft² constants — but the real
room editor never exposed a mode switch or any way to add a measured
opening. Added an "Opening entry" selector and a real add/edit/remove list
of measured openings; verified against independently-derived Materials
cost for both modes (quick default: 5 gal → $210.00; detailed with one
3×6.67 measured opening: 4 gal → $168.00). See `TOOL_BUG_FIX_LOG.md`.

### 6. Pro estimate summary (`tool-specs/06`) — "Pro surfaces and summary" area
**Verdict: the largest completeness gap this task found is now closed, plus a real crash fixed.**
`tool-specs/06` requires the estimate summary to consume "itemized other
materials, supplies allowance, additionalLabor, direct expenses including
travel" — `assembleProjectEstimate` already fully implemented all four,
but **the real project editor exposed no way to enter any of them at
all.** A painter could not itemize prep labor, materials, an allowance, or
travel/expenses through the interface — a core $99-tool completeness gap
the independent review named explicitly. **Fixed this session:** added a
real "Additional costs" section with add/edit/remove UI for all four
(named prep/cleanup labor tasks with hours and rate; itemized other
materials by description/unit/quantity/unit cost; the supplies-allowance
mode selector, now actually editable; named other direct expenses
including the travel line a configured default seeds). Verified end to
end through the independent review's own "Required completion test": an
empty project → named prep task, itemized material, allowance, travel
expense → independently-derived cost/overhead/price → save → reopen →
issue → restored results, all through the real interface.

Suggested-vs-custom price mode, minimum-cent-price prefill, incomplete
surfaces blocking final margin, and negative-profit retention are all
verified (`tests/engine/pricing.test.ts`, `tests/engine/estimate.test.ts`,
mutation tests). **Fixed this session (V5-07):** a custom selling price
with more than 2 decimal places (e.g. "12.005") was accepted as a
complete, issueable price — now enforces CALCULATION_SPEC.md §6's
two-decimal rule. **Genuine crash fixed this session:** while completing
the costing interface (see "Room and surface entry" and item 5 above),
found that `assembleProjectEstimate` constructed a Decimal directly from
raw, unvalidated text for every additional-labor/other-material/
other-expense/supplies-allowance field — a freshly-added blank line (the
normal state the instant its "+ Add" button is clicked) threw and crashed
the whole summary. Every field is now validated first. **Confirmed
missing (PRO-014):** no drag-and-drop reordering or index field on
rooms/surfaces — a UX nicety the spec mentions, not a
calculation-correctness issue. 12/19 verified, 6 unverified, 1 missing.

### 7. Price Book Health (`tool-specs/07`)
**Verdict: two real defects fixed this session on top of the prior session's real-data fix; wall/ceiling/trim/door models fully verified.**
**Fixed in a prior session (R08):** Price Book Health previously showed one
hardcoded example with a null price — completely disconnected from real
saved services. It now reads and persists actual `ServiceDefinition`
records, with a full CRUD UI and per-kind (wall/ceiling/trim/door)
unit-cost derivation verified against hand-computed fixtures in
`tests/domain/serviceHealthAssembly.test.ts` (14 tests) and
`tests/engine/serviceHealth.test.ts`. **Fixed this session (V5-01):** a
saved service with a 100% (or negative) target margin crashed the health
calculation outright — now returns a structured invalid state. **Fixed
this session (V5-10):** a newly-added trim or door service pre-filled an
invented 4ft developed width (or a fully-specified 3×6.67 two-sided door)
instead of leaving required geometry unset — a silently-assumed paint
consumption number for a job the customer never described. **Confirmed
remaining gap (HEALTH-016):** no expand/detail affordance in the health
table to show the full assumptions breakdown inline — the data exists in
the row, the UI just doesn't surface it on demand. 10/18 verified, 7
unverified, 1 missing.

### 8. Pro customer estimate output (`tool-specs/08`)
**Verdict: the allow-list guarantee is solid; most presentation requirements are unverified, not known-broken.**
The customer-document allow-list (no internal costs/margins/rates leak
through, even from a hand-assembled object with a leaked private field) is
verified in `tests/domain/lifecycle.test.ts`. This is the single most
important guarantee for a paid tool's output and it holds. **Weakest area
in this audit by verified-count (2/12 verified, 8 unverified, 2 missing):**
multi-page print/PDF rendering with long names and many rooms (P02), script-
like text rendering safely as literal text and logo format/size validation
(P05) are unverified — no dedicated test drives the actual print/PDF render
path or feeds it adversarial text/logo input. **Confirmed missing:** DOC-004
(no distinct "draft preview" render path separate from the issued-document
allow-list test — a draft-scope-only preview may not enforce the same
allow-list independently) and DOC-010 (no logo import/embedding code path
exists at all, despite `BusinessInfo.logo` being defined in the data model).
This is the tool most in need of dedicated browser-level rendering tests
before shipping with full confidence.

### 9. Actual-cost review (`tool-specs/09`)
**Verdict: both dual-entry modes the spec requires are now complete; core financial correctness verified.**
**Fixed in a prior session (ACT-010):** overhead now supports both
spec-required modes (confirm the baseline's allocated overhead, or enter a
real actual figure) — previously hardcoded to actual-only. **Fixed this
session (V5-11):** that same overhead confirmation rejected the app's OWN
computed baseline whenever it had more than 10 fractional digits (an
ordinary, non-round production rate like 137 ft²/hr/coat, not an extreme
value) — the feature worked only for conveniently round fixture numbers.
Now uses the computed value directly instead of round-tripping it through
the manual-text-entry parser. **Fixed this session (ACT-011):** added the
second spec-required dual mode — actual labor entered directly OR as
hours × rate — previously `laborBreakdown` was defined in the domain model
and validated on import but never exposed in any UI. **Fixed this session
(V5-06):** a corrupted or malformed frozen baseline (NaN, Infinity,
wrong-shaped) was accepted as a trustworthy historical cost; now rejected
at both read and import time. Loss retention, undefined-margin-at-zero-
baseline, and in-progress-vs-final gating are all verified against
hand-derived fixtures (`tests/engine/actuals.test.ts`,
`tests/engine/fixtures.test.ts`). 15/21 verified, 6 unverified, 0 missing.

### 10. Pro backup/restore (`tool-specs/10`)
**Verdict: strongest area of this audit — 10 of the 22 combined independent-review regressions across two review rounds were here, all fixed.**
From the v4-round review: R03 (replace-all left business settings
untouched), R04 (ABA version hazard, fixed with a new global counter), R05
(keep-both didn't remap service-to-paint references or preserve
provenance), R06 (malformed customer-document snapshots accepted on
import), R11 (import-as-copies used a stale version), and R12 (export read
stale in-memory state instead of committed storage). From this session's
v5-round review: V5-02 (keep-both was ALSO wrongly remapping pre-existing
LOCAL services that happened to share a paint ID — R05's own fix had been
too broad), V5-03 (an existing user's real pre-v3 database could reuse a
version token across the schema upgrade, not just across replace-all),
V5-04 (a legitimately revised, previously-actualed project's own backup
rejected itself the moment a second revision was issued), and V5-06 (a
corrupted/NaN historical cost record was accepted as trustworthy, both on
read and on import). All ten are fixed and verified — see
`TOOL_BUG_FIX_LOG.md` for each. Combined with the substantial prior-session
work (full schema validation, atomic multi-store commits, conflict
preview/choice UI), this area is 27/34 verified, 3 unverified, 4 missing.
**Confirmed remaining gaps:** BACK-019/025 (no logo embedding/size-limiting
on export — same root cause as DOC-010 above, since logos are entirely
unimplemented), BACK-026 (an explicitly-acknowledged open product/policy
decision named in the spec's own text, not an oversight), BACK-009 (no
dedicated test or reachable feature for one specific named scenario).

---

## Cross-cutting engine layer (used by every tool above)

- **Fixed arithmetic regression (20/20 verified):** every historical
  rounding/precision defect this multi-session project found and fixed
  remains fixed — full regression coverage, zero gaps.
- **Geometry and paint aggregation (16/30 verified, 12 unverified, 2
  missing):** core wall/ceiling/trim/door area and gallon-purchasing
  formulas are verified against hand-derived fixtures and property tests
  (order-independence, pooling inequality, gallon-bound). **Confirmed
  missing:** GEO-014 (no validation rejects two conflicting records under
  the same paint-variant ID in a snapshot) and GEO-027 (an asymmetric-count
  feature that appears unimplemented).
- **Labor, expenses and supplies (10/20 verified, 10 unverified, 0
  missing) — every confirmed gap from the prior session is now fixed.**
  The core formulas (production hours, supplies allowance modes, overhead
  allocation) are verified. **Fixed this session:** COST-007/008 (the
  additional-labor UI didn't exist at all, so multiple named tasks each
  correctly contributing hours×their-OWN-rate was previously untestable
  through the interface) and COST-014/015 (a configured travel default was
  never actually applied to a new draft, and — once the UI existed to check
  it — was confirmed never re-applied on later edits). Remaining
  unverified rows are specific input-combination edge cases without a
  dedicated test yet, not known defects.
- **Shared parsing and result state (15/30 verified, 13 unverified, 2
  missing) — one confirmed gap fixed this session.** The missing/invalid/
  valid-zero trichotomy and the numeric grammar (reject "12abc", scientific
  notation, thousands separators, etc.) are thoroughly verified in
  `tests/engine/parse.test.ts`. **Fixed this session (CORE-021/V5-07):** a
  three-decimal selling total (e.g. "12.005") was accepted as complete in
  both the Pro estimate summary and the free job-cost calculator; both now
  enforce the approved two-decimal precision. **Confirmed remaining
  gap:** CORE-020 (a crash-on-malformed-input risk identified by
  inspection, never exercised with an actual non-string value).
- **Boundary matrix (10/61 verified, 22 unverified, 29 missing) — the
  weakest cross-cutting area.** These are CALCULATION_SPEC.md §1's hard
  engineering bounds (dimensions ≤100,000 ft, area ≤1,000,000,000 ft²,
  monetary inputs ≤$1,000,000,000, rates ≤1,000,000/unit, etc.).
  **Important distinction:** the *calculation engine itself* already has a
  safety net against the dangerous consequences of an out-of-range value —
  `CORE-price-03/04/05` verify that an extreme target ratio or cost never
  produces `Infinity` or a silent wrong answer, returning
  `out_of_supported_range` instead. What's missing is *field-level*
  rejection: `parseDecimalField` (`src/engine/parse.ts`) has no upper-bound
  (`max`) option at all, and the existing `MAX_MONETARY_INPUT` constant is
  unused dead code. Concretely, this means a user CAN type
  `1000000000.001` into a manual area field or an out-of-range
  `overheadRatio`/`wasteRatio` and the app will accept it at the input
  boundary rather than reject it immediately — the engine will still
  behave safely, but the UX doesn't catch the mistake early. Wiring real
  bounds into every affected field (roughly two dozen fields across
  business settings, room/surface entry, and service definitions) is a
  substantial, systematic follow-up — flagged here as concrete remaining
  work, not attempted this session given its size relative to the
  session's remaining budget.
- **Browser, accessibility and privacy (1/13 verified, 9 unverified, 3
  missing):** the real-browser-style component harness
  (`tests/browser/*.test.tsx`, jsdom + testing-library) exercises genuine
  click/type/save/reload workflows and real IndexedDB transactions, but
  narrow-screen layout, keyboard-only navigation, and screen-reader
  labeling have no dedicated automated coverage, and none of this was
  checked in an actual browser this session (see Automated vs. Browser
  Results below). **Confirmed missing:** UX-004 (an explicitly
  `proposed_hardening` item, confirmed unimplemented), UX-006 (no analytics
  system exists to have a privacy risk against), UX-011 (no such messaging
  exists).
- **Projects, revisions and local persistence (9/14 verified, 4 unverified,
  1 missing):** draft/issued isolation, duplicate-project independence, and
  version-conflict handling are all verified. **Confirmed missing
  (LIFE-014):** no delete-project action exists in the UI at all —
  explicitly acknowledged in the project's own prior documentation, not
  newly found.

---

## Automated vs. browser results — reported separately, as required

**Automated (Vitest, jsdom where noted):** 471 passed, 3 skipped (R01/R02/R14,
explicitly out of scope), 0 failed, across 52 test files (`evidence/v6/vitest_verbose.log`).
Restricting to the same tools-only subset the independent review used
(excluding `tests/api/**` and `tests/lib/**`, the payment/licensing tests):
419 passed, 3 skipped, 46 files. `npx astro check`: 0 errors. `npx astro
build`: succeeds. Full logs in `evidence/v6/`.

**Real browser: performed this session for the free tools; still not
possible for the Pro tool, and this is a genuine, disclosed limitation, not
an oversight.** Using an actual dev-server browser tab (not jsdom), this
session verified:
- The free interior calculator's sample fixture (net 563 ft², 4 gal,
  $168.00), the new `includeWalls` toggle producing a genuine ceiling-only
  result (320 ft², 3 gal, $126.00) with the "at least one surface" error
  shown when both are off, and the new prep-hours field correctly adding to
  labor cost ($392.67 total for 8.33 hours at $32/hr on top of paint) — all
  matching the independently-derived expected values exactly.
- The free job-cost calculator correctly rejecting a three-decimal price
  ("12.005") with the exact error message, and accepting a valid two-decimal
  price with a correct complete result ($115.00 cost, $150.00 price, 23.3%
  margin).

**The Pro tool itself remains behind its real payment gate, and this
session did not — and will not — bypass it.** This task explicitly requires
preserving the existing access boundary and forbids production bypasses;
this environment has no real Dodo Payments test-mode credentials, so a
genuine browser session cannot reach the unlocked Pro workspace without
either fabricating a payment record (prohibited) or modifying production
access-control code (also prohibited, and against this task's own explicit
instruction). All Pro-tool verification this session therefore used the
jsdom + `@testing-library/react` component harness (`tests/browser/*.test.tsx`),
which renders the real `ProApp` component directly (never through the
gate) against real IndexedDB transactions and drives real click/type/submit
events — genuine component-level testing, not a hand-constructed fixture,
and explicitly sanctioned by this task's own scope ("Test the tools through
isolated component and browser fixtures without adding production
bypasses"). It does **not**, however, exercise real print/PDF rendering,
real mobile viewport layout, or real screen-reader behavior for the Pro
tool specifically. **This remains the most important limitation of this
session's Pro-tool evidence** — the "Pro customer output" and "Browser,
accessibility and privacy" areas above (the two weakest by verified-count)
are exactly the areas a real Pro-tool browser session would add the most
confidence to, and reaching one requires either real payment credentials or
the user's own explicit decision to test purchase separately.

---

## Bottom line

**A painter can now reliably complete these full workflows** through the
real interface, with independently-verified arithmetic and no known crash
or silent data loss on the paths tested: create a project, enter
room/surface scope (including measured, not just quick-constant, openings),
itemize every approved additional cost (prep labor, other materials, a
supplies allowance, travel/direct expenses — a completeness gap this
session closed after an independent review named it as the main remaining
$99-tool gap), review costs, set a suggested or custom price (with the
approved two-decimal precision now enforced), save, reopen, issue an
estimate (which correctly freezes its outputs and supersedes the prior
issued revision), view the customer document, record actual costs against
the issued baseline (with the choice of confirming the baseline's own
overhead allocation — now correct even for ordinary non-round production
rates — or entering actual labor either directly or as hours × rate),
export a backup, and import it back via any of the three modes with correct
conflict handling, including through a real pre-v3-to-v3 database upgrade.

Two independent review rounds have now each reproduced a set of real
regressions against the delivered source (11 in the v4 round, 11 more in
this v5 round) and every one has been fixed with test-first evidence; the
second round also caught a genuine evidence-accuracy mistake in the first
round's own report (LIFE-003), which is corrected above rather than
repeated.

**What remains before this is a fully audited $99 product:** the boundary-
matrix field-validation sweep (systematic but scoped — the calculation
engine's own safety net already prevents wrong numbers here, this is a
UX-completeness gap), real-browser verification of print/PDF output and
accessibility for the Pro tool specifically (blocked by the real payment
gate this task correctly requires preserving), the free interior
calculator's own quick/detailed opening switch (distinct from the Pro
version fixed this session), logo embedding across both the customer
document and backup export, and a Price Book Health expand/detail
affordance. None of these are known to produce a wrong number or lose
committed data — they are gaps in either input-time validation strictness,
UI completeness, or test/browser coverage of already-correct-looking code,
each named concretely above and in `TOOL_REQUIREMENTS_MATRIX.csv` rather
than left as a vague caveat.
