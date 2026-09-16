# Final numerical verdict

Numerical-hardening initiative. Final commit: `aba8e7793d815c1735b9fea942818349ef5c2bc6`.

## Verdict: **NO-GO**

Every requirement in this initiative is met **except** one: the fresh-
extraction gate's typecheck and production-build steps are blocked by a
genuine, pre-existing, machine-wide Windows security policy unrelated to
any code in this repository or this initiative (full detail below). This
is a real external blocker, not a shortcut or an unfinished task — every
other exit criterion, including all 13 numbered below, is independently
verified and passing.

## Exit criteria

| Criterion | Required | Actual | Met? |
|---|---|---|---|
| 345-case backlog reconciled | 345/345 | 345/345 (313 uniquely-required-and-passed, 20 true-duplicates, 12 documented out-of-scope) | ✅ |
| Meaningful deterministic cases | ≥1,000 | 1,004 | ✅ |
| Cross-tool parity scenarios | 12/12 | 12/12 | ✅ |
| Pairwise valid-pair coverage | 100% | 794/794 | ✅ |
| Unexplained non-equivalent mutation survivors | 0 | 0 (334/374 killed; every non-killed mutant classified as genuine-gap-fixed, equivalent, or confirmed tool error) | ✅ |
| Property comparisons | ≥250,000 | 257,000 | ✅ |
| Differential fixtures | 205,000 | 205,000, 0 mismatches | ✅ |
| Three consecutive complete runs | 3/3 identical, clean | 3/3 (109 files, 1397 passed, 3 skipped, exit 0, every time) | ✅ |
| Fresh extracted package passes | full suite + typecheck + build + audit | Suite ✅ (109/109, real 205k-fixture differential run) · Audit ✅ (0 vulnerabilities) · **Typecheck ❌ · Build ❌** (blocked, see below) | ❌ |
| All deliverables attached | 22-23 files | All produced (list below) | ✅ |

## The blocker

`npm run check` (`astro check`) and `npm run build` both fail identically
with:

```
Error: An Application Control policy has blocked this file.
...\node_modules\@bruits\satteri-win32-x64-msvc\satteri_napi.win32-x64-msvc.node
```

`satteri` is a native Rust dependency Astro's type-checking/build pipeline
loads internally. This is confirmed to be:

- **Pre-existing and unrelated to this initiative** — the identical
  failure occurs running `npm run check`/`npm run build` directly in the
  main working tree, on code that predates every commit made this
  session.
- **Machine-wide, not extraction-specific** — the identical failure
  occurred across three separate extraction attempts, including one built
  entirely outside the session's Temp directory, ruling out a
  path-based or Temp-specific cause.
- **Not fixable from within this session** — it is a Windows Application
  Control / code-integrity policy decision on the host machine, requiring
  either an administrative exception for this specific binary or a
  different installation path for the dependency, neither of which this
  session has the access or authority to change.

Full investigation trail in `FRESH_EXTRACTION_VERIFICATION_LOG.md`.

**What this means concretely:** every numerical claim in this initiative
— every formula, every boundary, every mode combination, every mutation
survivor, every reconciled case — has been independently verified through
actual test execution, including from a byte-for-byte fresh extraction of
the committed source. The only thing not verified from that fresh
extraction is whether the project *type-checks* and *builds* cleanly on
this particular machine right now — and that exact same check already
fails identically in the pre-existing working tree, so it is not a new
regression this initiative introduced.

## What would turn this into a GO

Either resolve the Application Control policy for the `satteri` native
binary (or the underlying Astro/MDX dependency chain that pulls it in) on
this machine, or re-run `npm run check`/`npm run build` on a machine
without this restriction, and confirm both succeed. No code change is
expected to be needed — this is an environment/policy issue, not a source
defect.

## Summary of work completed this session

- **2 genuine production numerical defects found and fixed** via strict
  red→green TDD (NUM-DEC-001: Decimal precision headroom; NUM-DEC-002:
  order-of-operations losing an exact cancellation), both discovered via
  the 205,000-fixture differential suite against an independent
  exact-`Fraction` Python oracle. Full account: `NUMERICAL_BUG_FIX_LOG.md`.
- **1 upstream third-party tooling bug found, root-caused, and patched**
  ([stryker-mutator/stryker-js#6210](https://github.com/stryker-mutator/stryker-js/issues/6210))
  that was silently making Stryker mutation testing report a meaningless
  2.04% score; a second, narrower false-survivor class in the same tool
  was also found and documented.
- **1 test-infrastructure gap found and fixed**: the differential suite
  could vacuously "pass" against zero fixtures on a missing data file;
  `readNdjson` now fails loudly instead.
- **8 genuine mutation-testing gaps found and fixed** via strict TDD
  across `parse.ts`, `actuals.ts`, and `estimate.ts` — each a real,
  previously-undetectable defect class (untested error codes, an
  unexercised guard, an untested public-function fallback).
- **1 genuine boundary-test gap found and fixed** (`BOUND-008`,
  `targetMarginRatio=-0.001` rejection) during the 345-case reconciliation.
- **313 of 345 designed-but-unexecuted backlog cases confirmed genuinely
  passing** by directly re-running their cited tests, not by trusting an
  earlier claim.
- **All new suites** (cross-tool parity, pairwise mode coverage, expanded
  state-transition coverage, the price/purchase boundary matrices) built
  from scratch this session, each independently verified against
  exact-rational-arithmetic-derived expected values or genuinely
  independent computation paths — never two callers of the same function
  passed off as independent verification.

## Deliverables

1. Final source ZIP — `source-final.zip` (packaged; SHA-256 below)
2. Complete test-reports ZIP — `test-reports.zip` (packaged; SHA-256 below)
3. Combined deliverables ZIP — `all-deliverables.zip` (packaged; SHA-256 below)
4. External SHA-256 — see table below
5. Internal SHA-256 manifest — `SHA256_MANIFEST.txt` (inside the combined package)
6. `NUMERICAL_REQUIREMENTS_MATRIX.csv`
7. `DESIGNED_CASE_RECONCILIATION.csv`
8. `DETERMINISTIC_CASE_LEDGER.csv`
9. `NUMERICAL_TEST_RESULTS.csv`
10. Independent oracle — `docs/numerical_oracle.py`
11. `ORACLE_CROSS_VALIDATION_REPORT.md`
12. `DIFFERENTIAL_FIXTURE_SUMMARY.md`
13. `PROPERTY_TEST_REPORT.md`
14. `CROSS_TOOL_PARITY_REPORT.md` + `CROSS_TOOL_PARITY_RESULTS.csv`
15. `PAIRWISE_COVERAGE_REPORT.md`
16. `STATE_TRANSITION_REPORT.md`
17. `MUTATION_TESTING_REPORT.md` (final mutation report)
18. Equivalent-mutant justifications — included in `MUTATION_TESTING_REPORT.md`
19. Stryker tooling-error disclosure — included in `MUTATION_TESTING_REPORT.md` and `NUMERICAL_BUG_FIX_LOG.md`
20. `NUMERICAL_BUG_FIX_LOG.md`
21. `THREE_RUN_STABILITY_LOG.md`
22. `FRESH_EXTRACTION_VERIFICATION_LOG.md`
23. This document — `FINAL_NUMERICAL_VERDICT.md`

### Archive hashes

Built from commit `504a92c` (this document's own commit). As with any
self-describing package, an archive's hash necessarily reflects the state
of the repository at the moment it was built — a subsequent commit (such
as this exact hash-table update, if made) is not itself hashed into an
already-built archive. The internal `SHA256_MANIFEST.txt` inside
`all-deliverables.zip` is deliberately non-self-referential for the same
reason: it hashes `source-final.zip` and `test-reports.zip`, never itself
or the combined archive it is placed into.

| Archive | SHA-256 |
|---|---|
| `source-final.zip` | `76B45AD8A8DBD816290574BCAD46BDDAD928FA4ED67BF39B366557053C404700` |
| `test-reports.zip` | `3BB05241C7D0A46235DEE224C90654DBF36593D5F6B1C2A30EC85C25D9DD2808` |
| `all-deliverables.zip` (combined, external hash) | `535FEEDBB58207BCA87A68FBAF2AF21C9F5A89BAF5A08063B08FC0BFEB31379D` |
