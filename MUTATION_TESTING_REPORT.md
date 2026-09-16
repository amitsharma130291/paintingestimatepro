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

## Final totals

| | Count |
|---|---|
| Total mutants | 374 |
| Killed | 334 |
| Timeout | 0 |
| No coverage | 2 |
| Ignored (Stryker-disable, justified) | 14 |
| Errors | 0 |
| **Genuine unexplained survivors** | **0** |
| Raw mutation score | 92.78% |

Per-file breakdown (final run): `cost.ts` 100%, `document.ts` 100%,
`geometry.ts` 100%, `paint.ts` 100%, `pricing.ts` 100%, `serviceHealth.ts`
100%, `actuals.ts` 96.67% (1 equivalent mutant), `decimal.ts` 80% (1
survivor, proven killed by the excluded-for-runtime property suite —
see below), `parse.ts` 86.42% (documented equivalent mutants +
message-prose-only mutants sharing a line with an already-tested code
value).

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

## Exit criteria

- Genuine unexplained non-equivalent survivors: **0**
- Every survivor classified: **genuine gap (fixed) / equivalent (proven) /
  confirmed tool error (documented)** — no "unknown" category
- Tool errors never counted as killed: **confirmed** (they appear in the
  raw Stryker output as Survived/Timeout/NoCoverage, not Killed; this
  report explicitly separates them rather than inflating the score)
