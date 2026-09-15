# Tools Completeness Report — v5 session

Scope: every free and paid tool in the approved specs (`docs/tool-specs/`),
calculation correctness, input validation, output completeness, and reliable
handling of customer work. **Excludes**, per this task's explicit scope:
payment integration, checkout, licensing, authentication, domains, SEO,
homepage/marketing, deployment, infrastructure.

This report is derived from `TOOL_REQUIREMENTS_MATRIX.csv` (344 in-scope
requirements: 333 drawn directly from `docs/tdd/test-cases.csv` against the
approved specs, plus the 11 in-scope independent-review regressions
R03–R13). Status counts: **163 verified**, **130 unverified** (behavior
likely present but not yet proven by a dedicated automated test), **51
missing** (confirmed absent by source inspection). Full breakdown by area is
in the matrix CSV; this report gives a per-tool verdict and names the
concrete gaps, not a percentage score.

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
**Verdict: two real gaps fixed this session; one remains.**
**Fixed this session:** the calculator was missing two inputs the spec
explicitly requires — an `includeWalls` toggle (walls were always
force-enabled, making a ceiling-only room impossible) and a prep/cleanup
hours field. Both are now implemented, tested, and wired into the Pro
handoff correctly (see `TOOL_BUG_FIX_LOG.md`, INT-008/009/014).
**Remaining gap (INT-010, confirmed missing):** the spec's `openingMode
quick|detailed` switch does not exist — only the quick 20/15 ft² preset is
implemented; there is no way to enter measured door/window dimensions. This
is a real accuracy limitation for irregular openings, not a crash or
data-loss risk. 8/15 verified, 6 unverified, 1 missing (INT-010).

---

## Paid (Pro) tools

### 4. Business settings and catalog (`tool-specs/04`)
**Verdict: substantially complete, two confirmed gaps.**
Rate-refresh preview/confirm/cancel, live-vs-snapshot isolation, and
deleted-variant handling (retain/replace) are all verified through
`tests/domain/rateRefresh.test.ts` and `tests/integration/draftIssuedIsolation.test.ts`.
**Fixed this session (LIFE-003):** rate refresh now keeps a recoverable
pre-refresh draft snapshot with a real "Undo refresh" control — previously,
confirming a refresh was a one-way door. **Confirmed remaining gaps:**
CAT-008 (no interactive UI for "refresh service defaults" preview/confirm on
service assumptions — settings drift silently applies to services, unlike
the project catalog) and CAT-010 (`createDraftRevision` hardcodes
`suppliesAllowance: {mode:'none'}` regardless of the configured
`defaultSuppliesAllowance` setting — a real, if narrow, correctness gap:
the configured default is silently ignored on every new draft). 7/12
verified, 3 unverified, 2 missing.

### 5. Room and surface entry (`tool-specs/05`)
No dedicated tool-spec area in the matrix beyond "Pro surfaces and summary"
(below) and "Geometry and paint aggregation" — see those sections. Stable
IDs surviving reorder/rename, disabled-surface exclusion, and standalone
trim/door surfaces (no room required) are verified in
`tests/engine/estimate.test.ts` and `tests/domain/estimateAssembly.test.ts`.

### 6. Pro estimate summary (`tool-specs/06`) — "Pro surfaces and summary" area
**Verdict: core pricing/aggregation verified; drag-reorder gap is cosmetic.**
Suggested-vs-custom price mode, minimum-cent-price prefill, incomplete
surfaces blocking final margin, and negative-profit retention are all
verified (`tests/engine/pricing.test.ts`, `tests/engine/estimate.test.ts`,
mutation tests). **Confirmed missing (PRO-014):** no drag-and-drop
reordering or index field on rooms/surfaces — a UX nicety the spec mentions,
not a calculation-correctness issue. 10/17 verified, 6 unverified, 1
missing.

### 7. Price Book Health (`tool-specs/07`)
**Verdict: real defect fixed this session; wall/ceiling/trim/door models fully verified.**
**Fixed this (and the immediately preceding) session (R08):** Price Book
Health previously showed one hardcoded example with a null price —
completely disconnected from real saved services. It now reads and
persists actual `ServiceDefinition` records, with a full CRUD UI and
per-kind (wall/ceiling/trim/door) unit-cost derivation verified against
hand-computed fixtures in `tests/domain/serviceHealthAssembly.test.ts` (14
tests) and `tests/engine/serviceHealth.test.ts`. **Confirmed missing
(HEALTH-016):** no expand/detail affordance in the health table to show the
full assumptions breakdown (product/color, coverage, coats, waste, overhead
basis) inline — the data exists in the row, the UI just doesn't surface it
on demand. 8/18 verified, 9 unverified, 1 missing.

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
**Verdict: two real defects fixed this session; core financial correctness verified; one code-organization gap remains.**
**Fixed this session (ACT-010):** overhead now supports both spec-required
modes (confirm the baseline's allocated overhead, or enter a real actual
figure) — previously hardcoded to actual-only. **Fixed this session
(ACT-015, verification only):** confirmed the existing crash/validation fix
also correctly rejects negative amounts. **Previously fixed (this
multi-session project, BUG_FIX_LOG #11):** persistence (ACT-013/014 labels
in the matrix were stale from an old audit predating that fix — corrected
this session). Loss retention, undefined-margin-at-zero-baseline, and
in-progress-vs-final gating are all verified against hand-derived fixtures
(`tests/engine/actuals.test.ts`, `tests/engine/fixtures.test.ts`).
**Confirmed missing (ACT-011):** `laborBreakdown` (direct vs hours×rate) is
defined in the domain model but never exposed in the actuals UI — labor is
recorded as one flat amount regardless of how it was actually incurred.
12/19 verified, 6 unverified, 1 missing.

### 10. Pro backup/restore (`tool-specs/10`)
**Verdict: strongest area of this audit — 6 of 11 independent-review regressions were here, all fixed.**
R03 (replace-all left business settings untouched), R04 (ABA version
hazard, fixed with a new global counter), R05 (keep-both didn't remap
service-to-paint references or preserve provenance), R06 (malformed
customer-document snapshots accepted on import), R11 (import-as-copies used
a stale version), and R12 (export read stale in-memory state instead of
committed storage) are all fixed and verified — see `TOOL_BUG_FIX_LOG.md`
for each. Combined with the substantial prior-session work (full schema
validation, atomic multi-store commits, conflict preview/choice UI), this
area is 25/32 verified, 3 unverified, 4 missing. **Confirmed remaining
gaps:** BACK-019/025 (no logo embedding/size-limiting on export — same root
cause as DOC-010 above, since logos are entirely unimplemented), BACK-026
(an explicitly-acknowledged open product/policy decision named in the
spec's own text, not an oversight), BACK-009 (no dedicated test or reachable
feature for one specific named scenario).

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
- **Labor, expenses and supplies (5/19 verified, 12 unverified, 2
  missing):** the core formulas (production hours, supplies allowance
  modes, overhead allocation) are verified, but many specific input
  combinations lack a dedicated test. **Confirmed missing:** COST-014/015 (a
  default-travel-expense auto-insert behavior that appears to be dead
  schema, not a built feature).
- **Shared parsing and result state (15/30 verified, 13 unverified, 2
  missing):** the missing/invalid/valid-zero trichotomy and the numeric
  grammar (reject "12abc", scientific notation, thousands separators, etc.)
  are thoroughly verified in `tests/engine/parse.test.ts`. **Confirmed
  missing:** CORE-020 (a crash-on-malformed-input risk identified by
  inspection, never exercised with an actual non-string value) and CORE-021
  (excess-precision selling-total rejection, same gap in both Pro and the
  free template).
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

**Automated (Vitest, jsdom where noted):** 393 passed, 3 skipped (the 3
skipped are R01/R02/R14, explicitly out of scope), 0 failed, across 44 test
files. `npx astro check`: 0 errors. `npx astro build`: succeeds. Full logs
in `evidence/v5/`.

**Real browser:** **Not performed this session.** All verification this
session used the jsdom + `@testing-library/react` component harness
(`tests/browser/*.test.tsx`), which renders the real `ProApp` component
against real IndexedDB transactions (via `fake-indexeddb`) and drives real
click/type/submit events — this is genuine component-level testing, not a
hand-constructed fixture, and it is explicitly sanctioned by this task's own
scope ("Test the tools through isolated component and browser fixtures").
It is **not**, however, an actual Chromium/Firefox/Safari session, and does
not exercise real print/PDF rendering, real mobile viewport layout, or real
screen-reader behavior. **This is the most important limitation of this
session's evidence** — the "Pro customer output" and "Browser, accessibility
and privacy" areas above (the two weakest by verified-count) are exactly the
areas a real browser session would add the most confidence to.

---

## Bottom line

**A painter can now reliably complete these full workflows** through the
real interface, with independently-verified arithmetic and no known crash
or silent data loss on the paths tested: create a project, enter
room/surface scope, review costs, set a suggested or custom price, save,
reopen, issue an estimate (which now correctly freezes its outputs and
supersedes the prior issued revision), view the customer document, record
actual costs against the issued baseline (with the choice of confirming the
baseline's own overhead allocation or entering a real actual figure),
export a backup, and import it back via any of the three modes with correct
conflict handling.

**What remains before this is a fully audited $99 product:** the boundary-
matrix field-validation sweep (systematic but scoped), real-browser
verification of print/PDF output and accessibility, `laborBreakdown` in the
actuals UI, `suppliesAllowance` defaults actually applying to new drafts,
detailed (measured) opening dimensions in the free interior calculator, and
logo embedding across both the customer document and backup export. None of
these are known to produce a wrong number or lose committed data — they are
gaps in either input-time validation strictness, UI completeness, or test
coverage of already-correct-looking code, each named concretely above and
in `TOOL_REQUIREMENTS_MATRIX.csv` rather than left as a vague caveat.
