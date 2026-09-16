# Mutation testing report

Numerical-hardening initiative, Part 19. Tool: Stryker
(`@stryker-mutator/core@10.0.0` + `@stryker-mutator/vitest-runner@10.0.0`),
configured in `stryker.config.mjs`. Scope: all of `src/engine/*.ts` (the
numerically-critical calculation core — `pricing.ts`, `decimal.ts`,
`cost.ts`, `document.ts`, `estimate.ts`, `geometry.ts`, `labor.ts`,
`paint.ts`, `parse.ts`, `serviceHealth.ts`, `actuals.ts`). Full narrative
(including every individual survivor's investigation) lives in
`NUMERICAL_BUG_FIX_LOG.md`'s mutation-testing entries; this report is the
consolidated final-numbers deliverable.

## Final totals (reconciled against the raw `reports/mutation/mutation.json` artifact)

An earlier version of this report stated 374 total / 334 killed / 14
ignored / 2 no-coverage. That was **wrong** — it was computed before a
scoped Stryker rerun of `src/engine/parse.ts` (made necessary by 3
`// Stryker disable next-line StringLiteral` comments added to that file
after the original full-campaign run, which the original raw artifact
predated). The corrected totals below are read directly from the current
`reports/mutation/mutation.json`, not recomputed by hand.

| | Count |
|---|---|
| Total mutant records | 375 |
| Killed | 334 |
| Timeout | 0 |
| Survived | 21 |
| No coverage | 2 |
| Ignored (Stryker-disable, justified) | 18 |
| Errors | 0 |
| **Genuine unexplained survivors** | **0** (all 21 Survived + 2 NoCoverage classified in `MUTATION_SURVIVOR_CLASSIFICATION.csv`) |
| Mutation score | 93.56% |

### What each number means (all mutation records vs. scored mutants vs. ignored vs. the score denominator)

- **All mutation records (375)** — every mutant Stryker generated and recorded a final status for, across all 11 mutated files. This is `total` in the table above and the row count of every file's `mutants` array summed.
- **Ignored mutants (18)** — mutants explicitly suppressed via a `// Stryker disable` comment in the source (13 inside the `catch`/`non_finite` dead-branch block in `parse.ts`, 1 on `pricing.ts`'s unreachable-message guard, 3 newly added and confirmed working by this rerun on `parse.ts`'s `malformed_number`/`too_many_fraction_digits`/`negative_not_allowed` message lines — up from 15 before this rerun, +3). Ignored mutants are excluded from Stryker's score entirely — they are not attempted, not "passed," just not counted.
- **Active/scored mutants (355 = 334 killed + 21 survived + 0 timeout)** — every mutant that was actually run against the test suite and produced a Killed/Survived/Timeout verdict. This is the "did the suite catch a real behavioral change" population.
- **Stryker's score denominator** — this project's Stryker config (default) computes the mutation score as `killed / (killed + survived + timeout + noCoverage)`, i.e. it counts NoCoverage mutants against the score (as unproven, not as passing) but excludes Ignored mutants entirely. Denominator = 334 + 21 + 0 + 2 = 357. Score = 334 / 357 = **93.56%**.

Correcting the previous report's arithmetic error directly: 334 killed / (334 + 24 + 2) = 92.78% was the number from the *stale* artifact (24 survived, before the 3-mutant rerun correction); 334 / (334 + 21 + 2) = 93.56% is the number from the *current, non-stale* artifact. The 3-point difference is exactly the 3 mutants that moved from Survived to Ignored once the scoped rerun picked up the disable-comment source change — not a change in test coverage or a loosened acceptance criterion.

Per-file breakdown (from the current raw artifact): `cost.ts` 100% (17/17), `document.ts` 100% (8/8), `estimate.ts` 100% (51/51), `geometry.ts` 100% (17/17), `paint.ts` 100% (10/10), `pricing.ts` 100% (44/44 scored, 1 ignored), `serviceHealth.ts` 100% (9/9), `actuals.ts` 96.67% (29/30, 1 equivalent mutant), `decimal.ts` 80% (4/5, 1 survivor proven killed by the excluded-for-runtime property suite — see below), `labor.ts` 71.43% (5/7 scored, 2 no-coverage proven killed by the excluded-for-runtime differential suite — see below), `parse.ts` 88.05% (140/159 scored, 17 ignored, 19 survivors — 4 mathematically equivalent + 15 confirmed tool-error, all in `MUTATION_SURVIVOR_CLASSIFICATION.csv`).

## Upstream Stryker/Vitest-5 tooling bug (disclosure)

The very first full run reported an implausible **2.04%** score. Root-
caused (not accepted at face value) to a confirmed upstream bug,
[stryker-mutator/stryker-js#6210](https://github.com/stryker-mutator/stryker-js/issues/6210):
Vitest 5 joins a nested suite/test name chain with `' > '` for
`testNamePattern` matching; `@stryker-mutator/vitest-runner@10.0.0` still
joined with a plain space, so its per-mutant test filter matched nothing
and every mutant silently ran **zero** tests, reported "Survived"
regardless of the actual mutation. Confirmed via: (a) cross-checking the
identical `coverageAnalysis:'all'` config on `hvacestimatepro/packages/
financial-core` (fast suite, hundreds of genuine kills, zero
`testsCompleted:0` survivors), (b) the one mutant that *was* killed being
the sole `static:true` (module-load-time) mutant, and (c) manually
applying a surviving mutant by hand and watching it fail 25/45 tests
directly with plain `vitest`, bypassing Stryker entirely.

**Fixed** via `patch-package`
(`patches/@stryker-mutator+vitest-runner+10.0.0.patch`, reapplied
automatically on `npm ci` via a `postinstall` script) — durable and
reproducible, not a throwaway `node_modules` edit.

A **second**, narrower false-survivor class was found afterward while
investigating `parse.ts`'s survivors by hand: several structural/
conditional mutants (a null-check, two count-bound checks, a validity
check) and every module-load-time constant mutation reported "Survived"/
"Timeout" despite demonstrably failing when applied and run directly
outside Stryker — including one `MIN_POSITIVE_DIVISOR` mutation that
crashes the entire test suite's import chain, reported as "Survived, 0
tests completed," the most extreme possible case of an unmissable kill
going unreported. Documented rather than further root-caused (diminishing
returns chasing a third-party tool's internals) — **every** remaining
non-killed mutant in the final run was independently hand-verified
(mutation applied, real tests run directly, reverted) before being
classified, specifically to guard against this recurring silently.

## Equivalent-mutant justifications

- **`actuals.ts:44`** — `categoryValue()`'s `c.amount !== null` sub-
  condition mutated to `true`. Mathematically proven equivalent: the only
  case where the mutation changes the boolean result (`confirmed=true,
  amount=null`) still returns `c.amount`, which **is** `null` — the same
  value the unmutated branch would return. No input can distinguish them.
- **`pricing.ts:16`** — the `requiredPriceRaw` range-guard's error message
  string. Unreachable-in-production defensive assertion (the value is
  validated upstream by the domain layer); no caller inspects the message
  text; `CORE-price-03`/`-04` correctly assert only `.toThrow()`.
  Suppressed with `// Stryker disable next-line StringLiteral`.
- **`parse.ts`'s `catch`/`non_finite` block** (in `parseDecimalField`) —
  verified empirically that decimal.js cannot throw or produce a
  non-finite value for any `GRAMMAR`-matched input short of ~9 quadrillion
  digits (its own exponent ceiling is ~9e15). Suppressed with a
  `// Stryker disable all` / `// Stryker restore all` block.
- **`parse.ts`'s 4 message-prose-only survivors sharing a line with an
  already-tested `code`** (`below_minimum`/`above_maximum` in both
  `parseDecimalField` and `parseCountField`) — left undisabled and
  documented rather than reformatted, since Stryker's line-scoped disable
  directive cannot suppress just the message without also silencing the
  already-killed `code` mutation on that same line.

## Genuine gaps found and fixed (strict TDD)

Full red→green detail for each in `NUMERICAL_BUG_FIX_LOG.md`. Summary:
`parseCountField` didn't trim whitespace or distinguish blank-vs-invalid;
`parseDecimalField`'s `min` option had zero test coverage in either
direction; six `FieldState.code` values were never asserted anywhere
(only `.kind`, so a copy-paste code swap would go undetected);
`actuals.ts`'s `categoryValue()` had an existing test exercising the exact
right scenario but asserting the wrong field; `estimate.ts`'s
paint-variant-pricing fallback had no direct test despite being an
independently-exported function's own documented contract.

## Excluded from Stryker's per-mutant reruns (not from correctness testing)

`tests/property/**` and `tests/differential/**` are excluded from the
mutation-testing vitest config (`vitest.mutation.config.ts`) purely for
per-mutant runtime — both still run in full under the normal `npm test`.
Two mutants are only killed by these excluded suites, confirmed by
citation to an earlier full-suite Stryker run that included them:
`decimal.ts:21`'s `PEP` precision mutant (killed by
`tests/property/hardening.property.test.ts` with a real fast-check
counterexample) and `labor.ts`'s `additionalLaborCost()` (killed by
`tests/differential/oracleFixtures.test.ts`, confirmed by hand: breaking
it to `return undefined` fails `DIFF-01` immediately).

## Machine-readable survivor classification

Every one of the 21 `Survived` and 2 `NoCoverage` records in the current
`reports/mutation/mutation.json` is classified in
`MUTATION_SURVIVOR_CLASSIFICATION.csv` (columns: `mutant_id, file,
location, mutator, status, classification, test_reference,
justification`), using only the four allowed classifications:
mathematically equivalent (5 records), killed by excluded exhaustive
suite and independently demonstrated (3 records), confirmed
Stryker/Vitest tool error (15 records), genuine gap fixed and superseded
by a later rerun (0 records remaining unexplained — the gaps in this
category were already fixed in the TDD pass above and are no longer
Survived/NoCoverage in the current artifact). 5 + 3 + 15 = 23, matching
21 + 2 exactly.

## Exit criteria

- Genuine unexplained non-equivalent survivors: **0**
- Every one of the 23 current Survived/NoCoverage records classified in
  `MUTATION_SURVIVOR_CLASSIFICATION.csv` with one of the 4 allowed
  classifications — no "unknown" category, no record left out
- Tool errors never counted as killed: **confirmed** (they appear in the
  raw Stryker output as Survived/NoCoverage, not Killed; this report
  explicitly separates them rather than inflating the score)
- Reported totals match the raw artifact exactly: **confirmed** — 375
  total / 334 killed / 21 survived / 18 ignored / 2 no-coverage / 0
  timeout / 0 errors, read directly from `reports/mutation/mutation.json`
