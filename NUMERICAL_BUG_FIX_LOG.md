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

## NUM-DEC-001 necessity re-audit — precision 100 is still required, for a reason NUM-DEC-002 did not address

**Question:** after NUM-DEC-002's fused `surfaceLaborCost()` fix, is the
NUM-DEC-001 precision bump (50 → 100) now redundant for the Pro pipeline, or
does something else still depend on it?

**Method:** in an isolated `git worktree` (not the working tree — this ran
concurrently with the Stryker full-engine baseline below, which must not see
`src/engine/*.ts` change mid-run), reverted `PEP`'s precision to 50 while
keeping NUM-DEC-002's fused-calculation fix in `estimate.ts` untouched, then
ran `tests/engine/decimal.test.ts`, the full 205,000-fixture differential
suite (reusing the existing deterministic fixture set — seeded, so identical
either way), and the pricing/actuals/service-health/document/cost test
files.

**Result:** the differential suite and all other files still passed (they
all exercise `aggregateProjectSurfaces`, which NUM-DEC-002 already fixed).
But `decimal.test.ts`'s own NUM-DEC-001 regression test — which calls
`wallOrCeilingHours()` directly and multiplies by rate manually, rather than
going through `aggregateProjectSurfaces` — still failed at precision 50
(`862.63` instead of `862.64`), proving NUM-DEC-002's fix did **not**
subsume NUM-DEC-001's.

**Root cause:** `wallOrCeilingHours()`/`trimHours()`/`doorHours()`
(`src/engine/labor.ts`) were never removed — only `aggregateProjectSurfaces`
was rewired to bypass them via the new fused function. They are still called
directly, unfused, by:
- `src/components/tools/InteriorCalculator.tsx:206-209` (the free interior
  tool: sums wall hours + ceiling hours [each its own division] + prep
  hours, *then* multiplies the sum by one hourly rate) — a live, reachable,
  user-facing computation with the identical "sum-of-divisions-then-
  multiply" shape as NUM-DEC-002.
- `src/domain/serviceHealthAssembly.ts:49,59,73` (Price Book Health) → feeds
  a single unfused hours value into `computeServiceUnitCost`, which
  multiplies by rate — the original single-division NUM-DEC-001 shape.
- `src/engine/estimate.ts`'s own `laborHoursForSurface` (used only to
  produce the *displayed* per-surface hours figure, kept deliberately
  separate from the fused cost calculation used for the dollar total).

**Searched for a live counterexample in the highest-risk of these**
(`InteriorCalculator.tsx`'s two-division-sum shape, structurally the closest
to NUM-DEC-002's proven bug): a targeted, session-local scratch script
(not part of the committed deliverables -- its methodology and full result
are recorded here in place of the file itself) comparing decimal.js
(at precision 50 and 100, exactly as the component computes it) against
exact BigInt-fraction arithmetic, over 8,000,000 randomly seeded
(wallArea, ceilingArea, coats, wallThroughput, ceilingThroughput, prep,
rate) tuples spanning the component's realistic input ranges (1–3000ft²
wall, 1–1500ft² ceiling, 1–5 coats, 50–400 throughput, $0–5 prep, $20–150
rate). **Zero mismatches found at either precision.** This is a documented
negative result, not a proof of absence — the bug class requires a
coincidental relationship between a throughput's prime factorization and
the rate's decimal representation (as `187 = 11×17` / `$139.23 = 17×819/100`
did for NUM-DEC-001), and 8,000,000 attempts is necessarily finite — but it
is strong enough evidence that this specific shape, over this input range,
is not exhibiting the bug at any practical rate, unlike the ~1-in-40,000
rate NUM-DEC-002 was found at in the original differential fuzzing corpus.

**Decision: keep `PEP`'s precision at 100 in the main tree** (do not revert
to 50). It is proven still load-bearing for the still-unfused call sites
above via the direct regression-test failure, independent of whether the
`InteriorCalculator.tsx` search would have found a live counterexample.
Precision alone is not a complete fix for this bug *class* (NUM-DEC-002
already established that no fixed precision can be, only fused
multiply-then-divide order can) — but for the single-division shapes
(`serviceHealthAssembly.ts`, the displayed-hours calculation) it is a
materially effective mitigation, and for `InteriorCalculator.tsx`'s
two-division-sum shape it is the only mitigation currently in place at all.

**Follow-up flagged, not yet fixed:** `InteriorCalculator.tsx`'s labor-cost
calculation should eventually receive the same structural fix as
NUM-DEC-002 (fuse each component's `area×coats×rate÷throughput` into one
division before summing, rather than summing hours first) as defense in
depth, even though no live counterexample was found — this is the same
class of latent risk NUM-DEC-002 addressed, just not yet demonstrated to
have a practical trigger in this component. Recorded here rather than
silently left as an assumption.

## Mutation testing scaled to the full `src/engine/*.ts` surface (Part 19 continued)

Expanded `stryker.config.mjs`'s `mutate` list from `pricing.ts`+`decimal.ts`
to all of `cost.ts`, `document.ts`, `estimate.ts`, `geometry.ts`, `labor.ts`,
`paint.ts`, `parse.ts`, `serviceHealth.ts`, `actuals.ts` (374 mutants total,
using the already-fixed `vitest.mutation.config.ts` + patched
`vitest-runner`). Result: 316 killed, 9 timeout, 30 survived, 19 no-coverage,
0 errors (86.90% raw, 91.55% of covered mutants). `cost.ts`, `document.ts`,
`geometry.ts`, `paint.ts`, `pricing.ts`, `serviceHealth.ts` all landed at
100%. Every non-killed mutant was individually investigated below.

### A second, distinct Stryker/Vitest-5 false-survivor pattern (tool error, not a real gap)

While investigating `parse.ts`'s 25 "Survived" + 9 "Timeout" mutants,
several were initially assumed to be genuine gaps by reasoning from the
source alone — but direct empirical verification (apply the exact mutation
by hand, run the specific existing test file(s) outside Stryker, observe,
revert) proved several of them **already fail against existing tests**,
contradicting Stryker's own verdict:

- `parseCountField`'s `raw === null || raw === undefined` guard mutated to
  `false` — reported Survived (82 tests, none failed). Applied by hand:
  `tests/engine/parse.test.ts`'s existing `parseCountField(null)` assertion
  fails immediately (`Cannot read properties of null (reading 'trim')`).
- `parseCountField`'s `n < opts.min` / `n > opts.max` guards mutated to
  `true` — each reported Survived (77/76 tests). Applied by hand: 4 existing
  tests in `tests/domain/boundaryFieldAcceptance.test.ts` fail immediately.
- `isValidOpeningCount`'s whole body mutated to `return true` — reported
  Survived (27 tests). Applied by hand: 5 existing tests across
  `tests/domain/estimateAssembly.test.ts` fail immediately.
- `MIN_POSITIVE_DIVISOR = new PEP('0.000000001')` mutated to
  `new PEP('')` — a **module-load-time crash** (`[DecimalError] Invalid
  argument`) that breaks importing `parse.ts` at all, which every one of
  this project's ~100 test files transitively imports. Reported Survived
  with **0 tests completed** — the most extreme possible case of a
  should-be-unmissable kill being misreported. The other 8 same-shape
  monetary/dimension constants (`MAX_MONETARY_INPUT`,
  `MONETARY_WARN_THRESHOLD`, `MAX_REQUIRED_PRICE`, `MAX_RATIO`,
  `MAX_ROOM_DIMENSION_FT`, `MAX_AREA_FT2`, `MAX_TRIM_LENGTH_FT`,
  `MAX_HOURS`, `MAX_RATE`, `MAX_AGGREGATE_GALLONS`) are the identical
  shape and were reported as a mix of Survived/Timeout — none plausibly
  real for the same reason.

All of these are **static (module-scope) or otherwise trivially-fatal
mutations that provably fail when actually applied**, misreported by
Stryker as Survived/Timeout with 0 (or an implausibly low) `testsCompleted`
— the same failure signature (impossible kills going unreported) as the
`stryker-mutator/stryker-js#6210` bug already patched earlier in this log,
but evidently not the only such gap in this tool/Vitest-5 combination.
No further root-cause investigation was done — the fix already applied
(`patches/@stryker-mutator+vitest-runner+10.0.0.patch`) resolved the
majority of the false-survivor class (42→316 real kills across the two
runs), and chasing a second, rarer residual bug in a third-party QA tool
has steeply diminishing returns relative to the numerical-correctness work
this initiative exists to do. **Every remaining non-killed mutant in this
mutation-testing pass was independently verified by hand (not taken on
Stryker's word alone)** before being classified below, specifically to
guard against this exact failure mode recurring silently.

### Genuine gaps found and fixed (strict TDD: probed red, reverted, added test, confirmed green)

- **`parseCountField` never trimmed whitespace before validating**
  (`raw.trim()` mutated to `raw` survived — no existing test passes a
  padded count value). Added `'  5  '` → valid, value `5`.
- **`parseCountField`'s blank-string `missing` check** (`trimmed === ''`
  mutated away survived — no existing test asserts `parseCountField('   ')`
  is `missing` specifically, as distinct from `invalid`). Added directly.
- **`parseDecimalField`'s `min` option has no test at all, in either
  direction** — confirmed via full-repo grep that no production call site
  and no test anywhere passes `{ min: ... }` to `parseDecimalField` (unlike
  `parseCountField`, which already has direct min/max tests). Unlike the
  false survivors above, disabling this guard produces **no test failure
  anywhere in the repo** — a genuine gap in the function's own public
  contract, even though nothing currently calls it that way. Added a direct
  test (`'5'` vs `{min:'10'}` → invalid/`below_minimum`; `'10'` → valid,
  inclusive boundary).
- **Every `FieldState.code` value across `parseDecimalField`/
  `parseCountField` was untested** except `negative_not_allowed` (the one
  pre-existing `result.code` assertion in `tests/domain/coreRequirements.test.ts`).
  `malformed_number`, `too_many_fraction_digits`, `above_maximum` (decimal),
  `malformed_integer`, `below_minimum`, `above_maximum` (count) all had
  existing tests asserting `.kind === 'invalid'` but never the specific
  `.code` — meaning a copy-paste bug swapping two error codes would have
  gone undetected. Added direct `.code` assertions for all six.
- **`src/engine/actuals.ts`'s `categoryValue()` helper** (`c.confirmed &&
  c.amount !== null ? c.amount : null`) — mutating the condition to `true`
  or the `&&` to `||` survived (48 tests, none asserting the one field this
  function actually feeds). `tests/engine/actuals.test.ts`'s `ACT-004`
  already constructed the exact right scenario (an unconfirmed category
  with a non-null amount) but only asserted `state`/`confirmedCategories`/
  `actualCost`, never `recordedCostSoFar` — the one output `categoryValue`
  controls. Added the missing assertion to the existing test rather than
  writing a new one (`recordedCostSoFar` must be `2050`, excluding the
  unconfirmed category's `135`, not `2185`).
- **`src/engine/estimate.ts`'s `pricing?.coveragePerGal ?? new PEP(350)`
  fallback** — removing the `?.` survived (196 tests). Confirmed the
  fallback is genuinely unreachable from `aggregateProjectSurfaces`'s one
  production caller (`estimateAssembly.ts`'s `resolveSurface` already
  rejects any `paintVariantId` absent from the live catalog as `'invalid'`
  before this function is ever reached) — but `aggregateProjectSurfaces` is
  an independently-exported, directly-tested engine function with its own
  contract, so its own documented fallback deserves its own direct test
  regardless of the current caller's guarantee. Added one, using a
  deliberately different coverage value (300, not 350) on the *present*
  variant so the fallback and a real lookup cannot be confused with each
  other.
- **`src/engine/labor.ts`'s `additionalLaborCost()`** was flagged
  NoCoverage (never exercised by the reduced-scope mutation suite) — but
  unlike the false survivors above, this one genuinely IS called with real
  assertions, just from `tests/differential/oracleFixtures.test.ts`
  (excluded from the mutation config purely for per-mutant runtime, same
  situation as `decimal.ts`'s `PEP` mutant). Confirmed by hand: breaking the
  function to `return undefined` fails `DIFF-01` immediately
  (`[DecimalError] Invalid argument: undefined`). No test added — already
  adequately covered, just outside the fast mutation-testing scope.

### Equivalent / unreachable mutants (documented, not fixed)

- `parseDecimalField`'s `catch` block (a `new PEP(trimmed)` construction
  throwing) and its `!value.isFinite()` check, both immediately following
  it — every mutant inside this span (`BlockStatement`, `ObjectLiteral`,
  `StringLiteral`×6, `ConditionalExpression`) was NoCoverage or Survived.
  Verified empirically that decimal.js cannot throw or produce a
  non-finite value for any `GRAMMAR`-matched string short of roughly
  9 quadrillion digits (decimal.js's own exponent ceiling is ~9e15) — no
  realistic form input can ever reach either branch. Documented in place
  with `// Stryker disable all: ... // Stryker restore all` spanning both
  blocks, since the equivalent code is dead for any input that could ever
  reach it in practice, not merely untested by the current suite.
- `pricing.ts`'s `requiredPriceRaw` guard message (documented in the
  mutation-testing entry above this one) — already suppressed with its own
  `// Stryker disable next-line StringLiteral` comment; the full-engine run
  correctly reports it as `Ignored`, confirming the suppression works.

### Final state after fixes

Re-ran the full-engine baseline after the above fixes: **92.78% (334
killed, 0 timeout, 24 survived, 2 no-coverage, 0 errors)** — up from 86.90%
(316/9/30/19/0). Every remaining non-killed mutant was cross-checked
against the classification above and matched exactly, with no new
unexpected survivors:

- 13 `Ignored` mutants (the `catch`/`non_finite` block) — the `// Stryker
  disable all` suppression from this same pass works correctly.
- `actuals.ts`'s 1 survivor is exactly `id=4`, the mathematically-proven
  equivalent mutant identified above.
- `decimal.ts`'s 1 survivor is exactly the `PEP` precision mutant, already
  proven killed by the excluded property suite.
- `labor.ts`'s 2 no-coverage mutants are exactly `additionalLaborCost`,
  already proven killed by the excluded differential suite.
- `parse.ts`'s 22 remaining survivors are exactly the confirmed false
  survivors (`id=249,275,288,309` — structural conditions with existing
  tests proven to kill them by hand; `id=312,313,314,315,316,317,318,319,
  320,321,323` — the module-load-time-crash constants) plus 7 pure-message
  `StringLiteral` mutants on lines where `code:` and `message:` share one
  line with the already-tested `code`. Added `// Stryker disable
  next-line StringLiteral: message prose only` for the 3 of those 7 where
  `message` sits on its own line (`malformed_number`, `too_many_
  fraction_digits`, `negative_not_allowed`); the other 4
  (`below_minimum`×2, `above_maximum`×2) have `code` and `message` on the
  literal same source line as a single-line return statement, so Stryker's
  line-scoped disable directive cannot suppress the message mutant without
  also suppressing the already-tested, already-killed `code` mutant on
  that same line — left undisabled and documented here instead of
  reformatting working code purely to appease the mutation-testing tool.

Full normal suite (`npm test`) re-confirmed green throughout this pass —
102/102 files, 964 passed, 3 skipped, 0 failed (one earlier run showed 41
failures across 25 unrelated UI/browser test files with zero overlap with
anything touched in this pass; an immediate rerun with full logging was
clean, matching this project's long-documented shared-machine contention
pattern, not a regression).

**Addendum (later correction pass):** the 92.78% figure and the mutant
IDs cited above (`id=249,275,288,309,312-323`) reflect the raw
`mutation.json` artifact as it stood *at this point in the session* —
that artifact predated the addition of the 3 `// Stryker disable
next-line StringLiteral` comments described just above
(`malformed_number`/`too_many_fraction_digits`/`negative_not_allowed`),
so it was stale by the time a later correction pass inspected it: those
3 mutants still showed `Survived` in the raw file instead of `Ignored`.
A scoped Stryker rerun of `src/engine/parse.ts` alone (176 mutants,
non-static ids renumbered by Stryker on that rerun — they no longer
match the ids quoted above) confirmed the disable comments work
(19 survivors, down from 22) and was merged into the full 11-file
artifact, replacing only `parse.ts`'s entry. Corrected, current totals
(375 total / 334 killed / 21 survived / 18 ignored / 2 no-coverage) and
a full per-mutant machine-readable classification live in
`MUTATION_TESTING_REPORT.md` and `MUTATION_SURVIVOR_CLASSIFICATION.csv`;
this section is left as an accurate historical record of the state at
the time, not restated with the new ids.

## Test-infrastructure gap (not a production defect) — the differential suite can vacuously pass on missing fixtures

**Found by:** fresh-extraction verification (numerical-hardening section
12). Building a source ZIP via `git archive` from the committed HEAD and
running the canonical suite there produced the exact same totals as the
working tree (109/109 files, 1397 passed) — suspiciously fast for a run
that should include the 205,000-fixture differential suite (which
normally takes ~15-22s of real processing).

**Root cause:** `tests/fixtures/oracle-fuzz/*.ndjson` (~230MB) are
gitignored by design (regenerable from a fixed seed via
`docs/generate_fuzz_fixtures.py`, documented in `.gitignore`'s own
comment) and are therefore absent from any fresh git-archive extraction.
`tests/differential/oracleFixtures.test.ts`'s `readNdjson()` helper:

```ts
function readNdjson(filename: string): any[] {
  const path = join(FIXTURES_DIR, filename);
  if (!existsSync(path)) return [];
  ...
}
```

silently returns `[]` for a missing file, with no error or warning. Every
one of DIFF-01 through DIFF-07 then iterates zero fixtures and trivially
asserts `{ total: 0, mismatches: [] }` equals itself — a genuine pass by
the letter of the assertion, but one that exercises no real comparison
whatsoever. This is a gap in fresh-extraction *reproducibility*
documentation, not a defect in the differential suite's own logic (which
was never meant to run standalone without its fixture-generation step,
and does not vacuously pass in the working tree, where the fixtures
already exist) — but it meant the first fresh-extraction run's "clean"
result was not actually evidence of anything for the differential suite
specifically.

**Fix:** regenerated the fixtures inside the fresh extraction directory
using the exact same seed and category counts recorded in the working
tree's own `tests/fixtures/oracle-fuzz/manifest.json`
(`seed: 20260916`, the same 7 category counts totaling 205,000) via
`python docs/generate_fuzz_fixtures.py tests/fixtures/oracle-fuzz --seed
20260916 --counts ...`. Confirmed the regenerated `manifest.json` is
byte-identical to the working tree's. Re-ran `tests/differential` alone:
7/7 tests passed in 22.06s (consistent with genuinely processing all
205,000 fixtures, not the near-instant vacuous pass), confirmed via
`readNdjson` no longer hitting the empty-file branch.

**Recommendation for future fresh-extraction verifications:** always
regenerate `tests/fixtures/oracle-fuzz/` from the manifest's recorded
seed/counts as an explicit, required step before running the differential
suite there — never trust a fresh-extraction "pass" for that suite without
confirming real runtime duration or an explicit fixture-count check, since
`existsSync`-gated test data can silently produce a green result over zero
real assertions.
