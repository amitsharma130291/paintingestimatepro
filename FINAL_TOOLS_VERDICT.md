# Final Tools Verdict — v7.2

Scope: free and Pro tool correctness, completeness, browser behavior,
customer-document output, backup/restore, and trustworthy evidence.
Excludes (as in every prior session): payments, checkout, licensing,
authentication, domains, SEO, deployment, marketing.

## What v7.2 corrected, in order

1. **Invalid logo evidence (v7.1 defect).** The PDF-evidence logo was a
   fully transparent 32x32 PNG — an image object existed, nothing
   visible ever rendered. Replaced with the real approved brand asset
   (`tests/fixtures/images/pep-logo-real.png`), added real pixel-level
   fixture-integrity tests (`sharp`, with a regression-proof block
   confirming the checks correctly reject the old defect), and closed a
   genuine gap found in the process: `MIN_LOGO_DIMENSION_PX` (16px) is
   now enforced, matching the existing maximum.
2. **A production-clean, genuinely long customer PDF.** 45 uniquely
   named rooms + standalone trim + 12 doors, real logo, real long Notes
   and Terms (a UI feature that had to be built first — see below), 2
   pages, zero internal-figure leakage, zero harness banner, zero
   `Infinity`/`NaN`, clean page break, zero overlapping text. Inspected
   both programmatically (24/24 checks) and visually.
3. **A reproducible real-browser desktop workflow (1440x900).** 40
   steps, creation through backup export/import-as-copy, with a real
   file download and a real file-input restore — not console-level
   domain-function calls. All 40 steps pass.
4. **The same core workflow at mobile (390x844).** 25 overflow
   measurements across every major state, all clean, after fixing one
   real defect found along the way (see below).
5. **Corrected viewport/browser evidence** — `REAL_BROWSER_V72_EVIDENCE.md`
   records this run's actual Chromium version, full user agent,
   viewports, device-pixel-ratio, and the exact commit/build mode/URLs
   tested, replacing the prior (still-accurate, but separately-dated)
   v7.1 evidence rather than leaving it as the only record.
6. **Backup/restore verified through the actual UI**, including
   cancellation-without-writes, a genuine merge conflict and its
   resolution, and confirmed non-colliding remapped IDs on import-as-
   copy — not a console-level substitute.
7. **Evidence integrity**: every browser claim in
   `REAL_BROWSER_V72_EVIDENCE.md` is backed by a JSON trace entry, a
   screenshot, or a downloaded artifact; evidence categories (unit /
   component-jsdom / real-browser / visual / PDF inspection) are
   labeled explicitly rather than blended.
8. **The requirements matrix and test ledger reconciled again** — 5 new
   stable requirement IDs (DOC-013, DOC-014, BACK-027, BACK-028,
   UX-014), all file references validated to exist, `TOOL_TEST_RESULTS.csv`
   regenerated from the final gate run.

## Genuine defects found and fixed this session

All found via the real-browser workflow itself, not by inspection alone
— see `TOOL_BUG_FIX_LOG.md`'s "v7.2 session" entry and
`REAL_BROWSER_V72_EVIDENCE.md` §6 for the full detail, root cause, and
fix for each:

- **BACK-027**: `createDraftFromIssued` leaked a stale
  `preRefreshCheckpoint`, breaking backup export/import for an ordinary
  refresh→issue→edit sequence.
- **BACK-028**: baseline-allocation actual-cost overhead persisted at
  raw (40+ digit) precision instead of money precision, also breaking
  backup export/import.
- **UX-014**: the restore preview's Cancel/Confirm button row
  overflowed at 390px mobile width.
- **DOC-013**: no UI path existed to set Notes/Terms at all.
- The dev-only harness's own banner leaked into its print/PDF capture
  (fixed with `print:hidden`; never part of the real product, which
  never renders this harness at all).
- Also carried over from the same real-workflow testing: a vacuously-
  passing assertion in `tests/integration/proEstimateLifecycle.test.tsx`
  that compared `undefined` against `.not.toBeNull()` without ever
  proving persistence — corrected to a genuine check.

No calculation formula was changed without a failing test demonstrating
a real defect; both BACK-027 and BACK-028 followed strict red→green TDD
(see the commit messages for each).

## Requirements matrix

`TOOL_REQUIREMENTS_MATRIX.csv`: **368 rows, all `verified`.** 0
unverified, 0 missing, 0 failed, 0 deferred, 0 decision_required. Every
`automated_test_reference`/`evidence_and_remaining_work` file path
(466 checked) resolves to a file that actually exists.

## Test suite

See the final gate logs (`logs/`) for the authoritative numbers from
the actual final commit. As of the last full run captured for this
document: **935 test cases, 932 passed, 3 skipped, 0 failed.** The 3
skipped are the same three payment/domain tests excluded from every
prior session (`tests/audit/independent-contract.test.ts`: R01, R02,
R14 — HTTP-503 payment retry, checkout-verification retry, and
purchaser-domain recovery links, all explicitly out of scope for this
tools-only task). No other test is skipped, `.only`'d, `.todo`'d, or
otherwise silently omitted (confirmed by a repo-wide grep — see the
final gate logs).

## Exit criteria checklist

| Criterion | Status |
|---|---|
| Every in-scope requirement verified | Yes — 368/368 |
| Zero missing/unverified/failed/deferred/decision-required | Yes |
| Zero in-scope test failures | Yes |
| Only the 3 excluded payment/domain tests skipped | Yes |
| Real logo visibly present in browser and final PDF | Yes — pixel-verified, not just an image object |
| Pixel-level checks prove the logo is not blank/transparent | Yes — `max_alpha=255`, `opaque_fraction=1.0`, 385 distinct colors |
| PDF is production-clean, no harness banner | Yes — 24/24 automated checks + visual inspection |
| Desktop 1440x900 workflow passes | Yes — 40/40 steps |
| Mobile 390x844 workflow passes, no unintended overflow | Yes — 25/25 measurements clean |
| Backup export/restore pass through the actual UI | Yes — real download + real file input |
| Import-as-copy passes through the actual UI | Yes — confirmed non-colliding remapped IDs |
| Browser evidence reproducible and matches its metadata | Yes — one metadata table, two trace files, one screenshot set each |
| Three consecutive full test runs pass | Yes — `logs/07`, `08`, `09`, all clean, no retries |
| Clean extracted-source verification passes | Yes — clean install, typecheck, oracle, audit, and build all clean on the first attempt; full suite clean after resolving unrelated machine contention (see extracted-package verification note above; `logs/10`-`15`) |
| Typecheck / oracle / build / audit all clean | Yes — 0 errors / 20 fixtures, 106 fields / 0 vulnerabilities / clean build, both in this repository and in the extracted copy |
| Working tree clean at the reported commit | Yes — `git status --short` empty at `b10dd54` |
| Every report claim has an attached artifact | Yes |

## Extracted-package verification note

The packaged source (`painting-pricing-calculator-v7.2-source.zip`) was
extracted into a brand-new directory, installed clean (`npm ci`, 0
vulnerabilities), and every gate rerun from that extracted copy alone --
no reuse of this repository's `node_modules`, build output, caches, or
untracked files. Typecheck, the numerical oracle, `npm audit`, and the
production build (including the pro-harness 404 recheck) were clean on
the first attempt.

The extracted-copy full test suite was **not** clean on the first
attempt: 4 files failed with `waitFor`-timeout errors while this shared
machine was running substantial unrelated concurrent work (several
sibling-project dev servers plus a ~10-worker Stryker mutation-testing
run on an unrelated project). Every one of those files passed
immediately when rerun in isolation, and the failure count tracked the
unrelated load exactly as it wound down across repeated reruns (4 -> 15
-> 10 -> 2 -> 0 failures) -- see `logs/14a` through `logs/14g` for the
full investigation. The suite passed fully clean (99/99 files, 932
passed, 3 skipped, 0 failed) once that unrelated load subsided. No test
or product code was changed to reach this result; this is the same
CPU-contention-under-full-parallelism class already documented in
`vitest.config.ts`, now directly demonstrated rather than inferred. The
original (un-extracted) repository's three consecutive full-suite runs
were clean on every run with no retries needed.

## Verdict

**GO.** Every requirement in this document's scope has been verified
against the final commit, including the extracted-package rerun above.
No requirement is deferred, caveated, or contingent on work not yet
done.
