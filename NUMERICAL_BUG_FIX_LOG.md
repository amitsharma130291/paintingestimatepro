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
