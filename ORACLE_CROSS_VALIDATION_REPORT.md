# Independent oracle cross-validation report

Numerical-hardening initiative. Independent oracle: `docs/numerical_oracle.py`
(exact `fractions.Fraction` arithmetic throughout — no fixed-precision
`Decimal`, no floating point at any step, converting to a decimal string
only at the final HALF_UP/ceiling formatting step). Never imports
production TypeScript code.

## Why exact `Fraction`, not `decimal.Decimal`

The first version of this oracle used Python's `decimal.Decimal` at high
precision (60 significant digits). It reproduced the *same class* of bug
NUM-DEC-001 found in production: dividing a value that produces a
repeating decimal (e.g. `1685.8 × 2 ÷ 86.4 = 8429/216`, a repeating
fraction since `216 = 2³×3³`) before multiplying by a value with a hidden
common factor (`135 = 27×5`, cancelling `216`'s factor of 27) truncates the
cancellation opportunity, just like the production bug did. Discovered when
a differential run showed a mismatch and independently recomputing the
true value with `Fraction` proved *production* was correct and the
*oracle's* "expected" value was wrong (`5268.125` exactly — a HALF_UP tie
that must round to `5268.13`, not the oracle's `5268.12`). Rewritten to use
`Fraction` exclusively, which has no precision limit and cannot truncate,
eliminating this entire bug class from the test tooling itself. Full
account in `NUMERICAL_BUG_FIX_LOG.md`'s "Test-infrastructure correction"
entries.

## Cross-validation against known-good fixtures

`docs/acceptance-fixtures.json` — 20 hand-derived reference cases spanning
every calculation kind (`job`, `price`, `interior`, `document`, `paint`,
`service`, `actual`) — cross-checked against the oracle via
`docs/verify_reference.py`.

| Metric | Result |
|---|---|
| Fixtures | 20/20 pass |
| Individual field assertions | 106/106 pass |
| Mismatches | 0 |

## Formula coverage

The oracle independently re-derives every formula in
`CALCULATION_SPEC.md`: gross/net wall and ceiling area, quick and detailed
opening deduction, trim and door paintable area, raw paint demand and
whole-gallon purchasing (same-variant pooling, different-variant
isolation), wall/ceiling/trim/door labor hours, supplies allowance
(none/flat/paint-percent), other-material and other-expense totals, direct
cost, overhead, estimated job cost, `requiredPriceRaw`/`approxPrice`/
`minimumTargetPrice`/margin/markup/profit and the six-way price status,
the full project-assembly pipeline (`assemble_project_estimate`, mirroring
`aggregateProjectSurfaces`), Price Book Health per-unit costing
(`compute_service_unit_cost`/`evaluate_service_health`, matched field-for-
field to production's real `ServiceUnitCost`/`ServiceHealthRow` shapes,
including `suppliesCostPerUnit`/`directExpensePerUnit`/
`additionalLaborHoursPerUnit`), and actual-cost review
(`evaluate_actual_review`, matched to production's `{confirmed, amount}`
per-category structure and three-way `in_progress`/`final`/
`out_of_supported_range` state, including the `AGG-005` aggregate-range
boundary).

## Bugs this oracle found in production

Both documented in full (repro, root cause, fix, confirmation) in
`NUMERICAL_BUG_FIX_LOG.md`:

- **NUM-DEC-001**: insufficient `Decimal` precision headroom (50→100
  significant digits) for a chained division that produces a repeating
  decimal, found via the 205,000-fixture differential run against this
  oracle.
- **NUM-DEC-002**: order-of-operations losing an exact cancellation in
  summed per-surface labor cost — no fixed precision can fix this class,
  only fusing the multiply-then-divide into one division.

## Exit criteria

- Oracle self-tests: **20/20 fixtures, 106/106 assertions, 0 mismatches**
- Independent of production code: **confirmed** (oracle never imports
  TypeScript source; comparison happens only in `tests/differential/`)
