# Numerical hardening — bug-fix log

Scope: independent-oracle differential fuzzing of the free/Pro calculation
engine (`src/engine/*.ts`, `src/domain/*.ts`), per the numerical-hardening
initiative. Every entry below follows strict red → green TDD: a minimal
reproduction, a failing regression test confirmed red against unmodified
behavior, root-cause analysis, the smallest correct fix, confirmation the
regression test passes, related tests, and the full suite.

## NUM-DEC-001 — insufficient Decimal precision headroom for a chained division

**Found by:** 205,000-fixture differential fuzzing of `assembleProjectEstimate`'s
underlying engine functions against an independent Python decimal oracle
(`docs/numerical_oracle.py`), comparing `jobCost`/`profit`/`minimumTargetPrice`/
`laborCost` field-by-field. First full run: 7 field-level mismatches across 5
fixtures (`proj-4950`, `proj-20929`, `proj-25568`, `proj-43976`, `loss-250`),
every one off by exactly one cent.

**Minimal repro:** a 110ft² ceiling, 5 coats, 187 ft²/hr throughput, $139.23/hr
labor rate, $120 other expense, 31.0% overhead ratio, price = $0 (zero_price).

**Root cause:** `hours = area × coats ÷ throughput` = 550/187, a *repeating*
decimal (187 = 11×17, and 550/187 doesn't reduce further). Decimal.js, at the
engine's configured precision (50 significant digits), must truncate this
non-terminating quotient. The truncated `hours` value is then multiplied by
`139.23` — and 139.23 = 17 × 819/100 has a *hidden factor of 17* that would
have exactly cancelled the 17 in 187's factorization, making the true
`laborCost` a terminating decimal (`819/2 = 409.50` exactly) if the division
had been deferred. Because the cancellation opportunity was already lost to
truncation, the computed `laborCost` carried a ~1e-47 residual that survived
summation into `directCost` (`658.5`) and then `overhead` (`658.5 × 0.310 =
204.135`, an *exact* HALF_UP tie) and `jobCost` (`862.635`, also an exact
tie) — flipping the tie's rounding from `862.64` (correct) to `862.63`.
Verified independently with Python `fractions.Fraction` (exact, no
precision at all): the true `jobCost` is `172527/200 = 862.635` exactly.

**Regression test:** `tests/engine/decimal.test.ts`, describe block
`"NUM-DEC-001"`. Confirmed red (`862.63` instead of `862.64`) against
unmodified code.

**Fix:** `src/engine/decimal.ts` — raised `PEP`'s `Decimal.clone({ precision
})` from `50` to `100`. A one-line change; CALCULATION_SPEC.md's own stated
intent ("at least 40 significant digits... headroom for chained divisions")
supports a generous margin. This alone resolved most, but not all, of the
originally-found mismatches (see NUM-DEC-002).

**Confirmed:** regression test green; `tests/engine/` (12 files, 114 tests)
green; full existing suite green (99/99 files, 933 passed [+1 new test], 3
skipped, 0 failed) — no regressions from the precision increase.

## Test-infrastructure correction (not a production defect) — the oracle itself needed exact arithmetic

After the NUM-DEC-001 fix, a second differential run still showed mismatches
(`proj-20929`: `laborCost` "expected" `5268.12`, production `5268.13`).
Independently recomputing `proj-20929`'s true value with `fractions.Fraction`
gave `42145/8 = 5268.125` exactly — a HALF_UP tie that **must** round to
`5268.13`. Production was correct; the oracle's own "expected" value was
wrong.

**Root cause:** `docs/numerical_oracle.py` originally used Python's
`decimal.Decimal` (precision 60) internally — the *same class* of bug as
NUM-DEC-001, just in the test tooling instead of production: dividing
`1685.8 × 2 ÷ 86.4 = 8429/216` (a repeating decimal, since 216 = 2³×3³) before
multiplying by `135` (which has a hidden factor of 27 that would have exactly
cancelled 216's factor of 27) truncated the cancellation opportunity the same
way.

**Fix:** rewrote `docs/numerical_oracle.py` to use `fractions.Fraction`
exclusively for all internal arithmetic — true exact rational arithmetic with
no precision limit at all, matching the approach `docs/verify_reference.py`
already used successfully. Rounding (`half_up`/`money`/`ceil_to_unit`) now
happens only via exact integer arithmetic at the final formatting step, via
a new `to_fixed_string(x, places)` (fixed-width, for output comparison) and
`to_minimal_string(x)` (minimal representation, for input echoing) pair of
functions. Also fixed a formatting bug found in the same pass: the original
`to_fixed_string` inferred the *minimal* number of decimal places from the
value itself, so `money(2623)` rendered as `"2623"` instead of `"2623.00"` —
silently breaking every fixed-width comparison against production's
`.toFixed(2)`-style output.

**Confirmed:** re-cross-validated against the existing 20 known-good
acceptance fixtures (`docs/acceptance-fixtures.json`) — still 20/20 fixtures,
106/106 assertions, 0 mismatches. This is disclosed here for transparency
(verify your verification tooling independently), not counted as a
production bug fix.

## NUM-DEC-002 — order-of-operations loses an exact cancellation in surface labor cost

**Found by:** the same 205,000-fixture differential run, now measured against
the corrected exact-Fraction oracle. 2 fixtures remained (`proj-58007`,
`proj-91861`), both `laborCost` (and downstream `directCost`/`jobCost`) off
by exactly one cent — proving NUM-DEC-001's precision bump, while a real
improvement, does not *fully* eliminate this failure class: no fixed Decimal
precision can, since the issue is fundamentally about *order of operations*
losing an exact cancellation, not insufficient headroom.

**Minimal repro:** a wall (1255.4ft², 2 coats, 12 ft²/hr throughput, $39/hr)
plus a trim run (287ft, 5 coats, 40 ft/hr throughput, $31/hr). Each surface's
own labor cost is individually exact (`$8,160.10` and `$1,112.125`
respectively — confirmed with `Fraction`), and their exact sum, `$9,272.225`,
is itself a HALF_UP tie that must round up to `$9,272.23`.

**Root cause:** `src/engine/estimate.ts`'s `aggregateProjectSurfaces`
computed each surface's `hours` first via `surfaceLaborHours` (for the wall:
`area × coats ÷ throughput = 6277/30`, a repeating decimal — 30 = 2×3×5
shares no factor with `1255.4 × 2`), then multiplied the *already-truncated*
`hours` by the hourly rate. `$39 = 3 × 13` has a hidden factor of 3 that
would have exactly cancelled the 3 in 30's factorization (`6277/30 × 39 =
244803/30 = 8160.1` exactly) — but only if the multiplication happened
*before* the division truncated it away.

**Regression test:** `tests/engine/estimate.test.ts`, describe block
`"NUM-DEC-002"`. Confirmed red (`9272.22` instead of `9272.23`) against
unmodified code (with NUM-DEC-001's fix already applied).

**Fix:** `src/engine/estimate.ts` — added `surfaceLaborCost(geometry, coats,
rateOrThroughput, loadedHourlyRate)`, which computes each surface kind's
labor cost directly from its raw inputs in a single fused
multiply-then-divide (`area × coats × rate ÷ throughput` for wall/ceiling/
trim, deferring the division to the very end so Decimal.js's division can
resolve the *true* exact quotient whenever the relationship secretly
cancels; door surfaces are unaffected, since their formula has no division
at all). `aggregateProjectSurfaces` now sums this function's per-surface
output directly instead of routing through the separately-computed `hours`
intermediate via `surfaceApplicationLaborCost`. `surfaceApplicationLaborCost`
itself (`src/engine/labor.ts`) is untouched and remains independently
correct and tested (`tests/engine/costRequirements.test.ts`) — it was never
wrong in isolation, only the call site that fed it an already-truncated
`hours` value was.

**Confirmed:** regression test green; `tests/engine/` (12 files, 114 tests)
green; full existing suite green (99/99 files, 934 passed [+1 new test], 3
skipped, 0 failed); **full 205,000-fixture differential re-run: 0 mismatches
across all 7 categories** (`DIFF-01` through `DIFF-07`), confirming both
fixes together are genuinely sufficient — not just for the originally-found
fixtures, but for the entire 205,000-fixture set spanning valid projects,
incomplete/invalid projects, boundary-adjacent purchases, loss/zero-price/
unpriced states, Price Book Health, and actual-cost review.

## Test-infrastructure correction (not a production defect) — Stryker mutation testing was silently no-op'ing under Vitest 5

**Found by:** Part 19 mutation-testing baseline (`stryker.config.mjs`,
`@stryker-mutator/core@10.0.0` + `@stryker-mutator/vitest-runner@10.0.0`,
scoped to `src/engine/pricing.ts` + `src/engine/decimal.ts`, 49 mutants). The
first complete run reported a **2.04% mutation score** (1 killed, 44
survived, 4 no-coverage) — implausible given `pricing.ts`/`decimal.ts` are
the two modules already subject to NUM-DEC-001/002 and the 205,000-fixture
differential suite above, which assert exact expected values against every
function in both files.

**Root cause (two independent, stacked problems, both confirmed empirically
before any fix was trusted):**

1. **Suite runtime, not a correctness bug.** `coverageAnalysis: 'all'` reruns
   the full covering-test set once per mutant. `tests/property/**` (13,000
   fast-check iterations per test, several needing 60–90s per-test timeout
   overrides) and `tests/differential/**` (100,000+ NDJSON fixture
   comparisons per test) made one run of the covering suite too slow to
   reliably complete within Stryker's per-mutant budget. Fixed by adding
   `vitest.mutation.config.ts` (identical to `vitest.config.ts`, excludes
   only those two directories) and pointing `stryker.config.mjs`'s
   `vitest.configFile` at it — both directories still run in full under the
   normal `npm test`.

2. **A confirmed upstream bug, not a local misconfiguration**
   ([stryker-mutator/stryker-js#6210](https://github.com/stryker-mutator/stryker-js/issues/6210),
   filed 2026-09-04, open at time of writing): Vitest 5 joins a nested
   suite/test name chain with `' > '` for `testNamePattern` matching;
   `@stryker-mutator/vitest-runner@10.0.0`'s `collectTestName` (duplicated in
   both `test-helpers.js` and the sandbox-copied `stryker-setup.js`) still
   joined with a plain space. The regex built from that space-joined name in
   `vitest-test-runner.js`'s `run()` therefore matched **zero** tests against
   Vitest's own `' > '`-joined internal names, so every per-mutant test run
   silently executed 0 tests and Stryker reported "Survived" (no failure
   observed) regardless of the actual mutation. This exactly matched the
   observed data: every dynamic (function-body) mutant showed
   `testsCompleted: 0` with a large `coveredBy` list; the one mutant that
   *was* killed (`decimal.ts:21`, `PEP`'s `Decimal.clone(...)`) was the sole
   `static: true` mutant, evaluated at module-import time before any
   per-test filtering applies. Confirmed as environment-specific (not
   inherent to the tool) by diffing against `hvacestimatepro/packages/
   financial-core`'s identical `coverageAnalysis: 'all'` config, which runs
   on Vitest 3.2.7 and produces hundreds of genuine kills. Independently
   confirmed the mutation was real and should have been caught: manually
   applying one surviving mutant (`ceilDecimal` returning `undefined`) and
   running the affected tests directly with plain `vitest` (bypassing
   Stryker) failed 25/45 tests immediately.

**Fix:** patched `collectTestName` in both
`node_modules/@stryker-mutator/vitest-runner/dist/src/test-helpers.js` and
`.../stryker-setup.js` to join with `' > '` instead of `' '`. Made durable
and reproducible from a fresh `npm ci` via `patch-package`
(`patches/@stryker-mutator+vitest-runner+10.0.0.patch` + a `postinstall`
script in `package.json`) rather than left as an unreproducible local
`node_modules` edit.

**Genuine test gaps found once the tooling was fixed** (baseline after both
fixes: 42/49 killed, 3 survived, 4 no-coverage — a believable, real result,
confirmed by manually re-verifying one survivor broke the suite when applied
by hand):

- `markup()` (`src/engine/pricing.ts`) was **never called** by production
  code or by any test — `tests/engine/pricing.test.ts`'s `CORE-price-08`
  reimplemented the margin/markup formulas inline rather than calling the
  real exported functions, so `NUMERICAL_REQUIREMENTS_MATRIX.csv`'s `PRICE-03`
  row was marked `verified` for a function nothing actually exercised (4
  no-coverage mutants: the whole function body, plus 3 variants of its
  `cost > 0` guard). `margin()`'s own `price > 0` guard (`if
  (!price.greaterThan(0)) return null;`) had the same problem one line up:
  187 tests covered the line via `evaluatePrice`, but none of them ever
  called `margin()` with a non-positive price (`evaluatePrice` only reaches
  `margin()` after separately handling `price === null` and
  `price.isZero()`), so the guard's own behavior was asserted nowhere.

  **Fix:** rewrote `CORE-price-08` in `tests/engine/pricing.test.ts` to call
  the real `margin`/`markup` exports directly (not a reimplementation), and
  added `CORE-price-09`/`CORE-price-10` asserting `margin(price<=0, cost)`
  and `markup(price, cost<=0)` both return `null` rather than dividing by
  zero. All three functions' guard/value behavior is now covered by tests
  that call the real production code.

- The `requiredPriceRaw` guard's error message string (`'targetMarginRatio
  out of range; validate before calling requiredPriceRaw'`) survived a
  `StringLiteral` mutation to `""`. Classified as a genuinely non-behavioral
  equivalent, not a gap: this is an unreachable-in-production defensive
  assertion (`targetMarginRatio` is validated upstream by the domain layer
  before ever reaching this function — the comment on the line above already
  says so), no caller inspects the message text, and `CORE-price-03`/`-04`
  correctly assert only `.toThrow()`. Documented in place with `// Stryker
  disable next-line StringLiteral: ...`, following the identical precedent
  already established in `hvacestimatepro/packages/financial-core` for
  free-text message prose (as opposed to a `code`/status string, which *is*
  behaviorally significant and is not exempted).

**Confirmed:** re-ran the full 49-mutant baseline after both the tooling fix
and the two test additions: `pricing.ts` **100% (44/44 killed, 0 survived, 0
no-coverage)**; `decimal.ts` **80% (4/5)**, with the sole remaining survivor
being the `PEP` precision mutant, which is not a gap — an earlier baseline
run (before the `tests/property/**` exclusion existed) recorded this exact
mutant (`decimal.ts:21:34`) as **Killed** by
`tests/property/hardening.property.test.ts`, with a real fast-check
counterexample (`seed: 20260914`, shrunk to `[1,1,259]`) — it is excluded
from the fast mutation-testing config purely for per-mutant runtime, not
because no test catches it. Full normal suite (`npm test`, includes
`tests/property/**` and `tests/differential/**`) re-run after all fixes:
102/102 files, 957 passed, 3 skipped, 0 failed — no regressions.
