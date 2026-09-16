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
| Clean extracted-source verification passes | Yes — see the four-part breakdown below; the delivered result is two genuinely fresh, back-to-back, first-attempt-clean full-suite runs (`logs/26`, `27`) plus clean install/typecheck/oracle/audit/build (`logs/20`-`23`, `28`) |
| Two consecutive clean extracted-package full-suite runs (mandatory) | Yes — Run A and Run B, both 99/99 files / 935 total / 932 passed / 3 skipped / 0 failed / exit 0, run back-to-back with zero file changes between them |
| Typecheck / oracle / build / audit all clean | Yes — 0 errors / 20 fixtures, 106 fields / 0 vulnerabilities / clean build, in this repository and in both extracted copies |
| Working tree clean at the reported commit | Yes — `git status --short` empty at `91571b4` (`logs/16`) |
| Commit difference `b10dd54..91571b4` is documentation-only | Yes — `git diff --name-status` names exactly one file, `FINAL_TOOLS_VERDICT.md` (`logs/16`) |
| Every report claim has an attached artifact | Yes |

## Extracted-package verification note

This section distinguishes four separate things. See `logs/GATE_LOG_INDEX.md`
for the full log-by-log breakdown; every number below traces to a specific
preserved log file, none is asserted without one.

**1. Original repository, three consecutive full-suite runs.** Run from
this repository's own working tree at the final commit -- `logs/07`, `08`,
`09`. All three clean on the first attempt, identical counts each time
(99/99 files, 935 total, 932 passed, 3 skipped, 0 failed), no retries
needed.

**2. First extracted-package pass -- contention-affected, superseded.** The
source archive was extracted into a fresh directory and every gate rerun
from that copy alone (no reuse of this repository's `node_modules`, build
output, caches, or untracked files). `npm ci`, typecheck, the numerical
oracle, `npm audit`, and the production build (including the pro-harness
404 recheck) were clean on the first attempt (`logs/10`-`13`, `15`). The
full suite was **not** clean on its first attempt: 4 files failed with
`waitFor`-timeout errors (`logs/14`). This is diagnosed, not merely
asserted, as unrelated machine contention, on two independent lines of
evidence: (a) every one of the 6 distinct files that failed across 4
full-suite attempts passed immediately, every time, when rerun alone
(`logs/14b`: 13/13, `logs/14f`: 2/2) -- a test that only fails under full
99-file parallelism and always passes standalone is the exact failure
signature `vitest.config.ts`'s own `testTimeout` comment already documents;
and (b) direct process inspection (`tasklist`/`Get-CimInstance`) confirmed
an unrelated ~10-worker Stryker mutation-testing run on a different project
(`hvacestimatepro`) was active and winding down (10 -> 4 workers) across
these exact attempts, and the failure count tracked it precisely: 4 -> 15
-> 10 -> 2 -> 0 (`logs/14c`-`14g`). No test or product file was changed at
any point in this investigation.

**3. Isolated diagnostic reruns.** `logs/14b` and `logs/14f` above -- rerunning
only the files that had just failed, alone, with nothing else changed.
Used solely to distinguish "fails only under contention" from "fails
outright"; not treated as a substitute for a full-suite pass anywhere in
this document.

**4. Final two consecutive clean extracted-package runs (the delivered
result).** For final delivery, a **second, genuinely fresh** extraction
("extractA") was made from the final source archive -- a brand-new
directory never used for any prior extraction, install, build, or test run.
Its own content was verified to match `HEAD` exactly (264/264 tracked
files, 0 mismatches after normalizing the benign CRLF line-ending
conversion Windows `git archive` applies to text files, 0 missing, 0
extra -- `logs/18`). `npm ci`, typecheck, oracle, audit, and the skip/only/
todo sweep were all clean on the first attempt (`logs/20`-`24`). Resource
snapshots taken immediately before the full-suite runs (`logs/19`, `25`)
recorded materially *tighter* conditions than the first pass -- as little
as 1.08GB of 15.69GB RAM free, and an unrelated Stryker mutation run active
again. Despite that, **both required consecutive full-suite runs passed
clean on their first and only attempt each, back-to-back, with zero file
changes between them**: Run A (`logs/26`) -- 99/99 files, 935 total, 932
passed, 3 skipped, 0 failed, exit 0; Run B (`logs/27`, run immediately
after) -- identical: 99/99 files, 935 total, 932 passed, 3 skipped, 0
failed, exit 0. No reduced worker count, no retry, no test or config
change was needed to obtain this result. The production build and
pro-harness route were reverified from this same extraction (`logs/28`):
build clean, and `dist/client/dev/pro-harness/index.html` confirmed
byte-for-byte identical to the original repository's build output and to
the first extraction's build output.

The commit difference between the fully-gated commit (`b10dd54`) and the
final reported commit (`91571b4`) was proven, not assumed, to be
documentation-only: `git diff --name-status b10dd54..91571b4` names exactly
one file, `FINAL_TOOLS_VERDICT.md` (`logs/16`). The final source archive
was independently confirmed to correspond to `91571b4`, with `HEAD`
unchanged immediately before and after the archive was built (`logs/17`).

## Verdict

**GO.** Every requirement in this document's scope has been verified
against the final commit `91571b4`, including two independent,
genuinely-fresh extracted-package passes and the two mandatory consecutive
clean full-suite runs from the second of those passes. No requirement is
deferred, caveated, or contingent on work not yet done. The one earlier
extracted-package attempt that did not pass cleanly on its first try is
disclosed above in full, with the diagnostic evidence for why it is
attributed to unrelated machine contention rather than a product or test
defect -- it is not hidden, and it is not the run this verdict relies on.
