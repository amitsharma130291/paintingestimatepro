# Property-based test report and seed ledger

Numerical-hardening initiative, Part 16 (25 required properties). Library:
`fast-check@^4.10.0`. All property tests are deterministically seeded —
`{ seed, numRuns }` passed explicitly to every `fc.assert(fc.property(...))`
call, so any run (including CI) reproduces the exact same generated
sequence and any failure ships a reproducible counterexample.

## Seed ledger

| File | Seed | Runs per property | Properties (it blocks) | Comparisons |
|---|---|---|---|---|
| `tests/property/document.property.test.ts` | 20260914 | 9,000 | 2 | 18,000 |
| `tests/property/geometry.property.test.ts` | 20260914 | 9,000 | 4 | 36,000 |
| `tests/property/paint.property.test.ts` | 20260914 | 9,000 | 4 | 36,000 |
| `tests/property/pricing.property.test.ts` | 20260914 | 9,000 | 7 | 63,000 |
| `tests/property/hardening.property.test.ts` | 20260916 | 13,000 | 8 | 104,000 |
| **Total** | | | **25** (26 counting one property split across `it` blocks) | **257,000** |

`document`/`geometry`/`paint`/`pricing` files share seed `20260914`;
`hardening.property.test.ts` (added this session, covering properties 14,
17, 19, 20, 21, 22, 25) uses `20260916` and a higher `NUM_RUNS` (13,000,
bumped from an initial 11,000) specifically to push the combined total
comfortably past the required 250,000.

## The 25 required properties (by number)

Covered across the five files above — round-trip invariants (format↔parse,
save↔reopen), monotonicity (price increases don't decrease margin),
idempotence (re-evaluating a finalized actual review twice agrees),
commutativity/order-independence where the spec requires it (surface
order never changes totals), aggregate-equals-sum-of-components, and the
hardening-specific properties added this session:

- **P14** — renaming a room changes no calculated totals.
- **P17** — a rate refresh followed by an undo restores byte-identical
  output to the pre-refresh state.
- **P19** — negative profit is never clamped to zero.
- **P20** — customer output contains only explicitly allow-listed fields
  (`buildCustomerDocument`'s output always passes
  `assertOnlyAllowedFields`, never leaking raw cost/labor/overhead/margin
  figures as its own keys).
- **P21** — results contain no `NaN`, `Infinity`, or negative-zero
  display artifact (every `Dec` field in the assembly result is finite
  and never displays as `"-0.00"`).
- **P22** — decimal formatting followed by supported parsing preserves
  the intended value (`toMoneyString(x)` round-trips through
  `parseDecimalField` back to the same money-rounded value, for any
  supported input).
- **P25** — an aggregate total always equals the exact sum of its
  independently-computed components.

Full per-property descriptions live as the `it()` names inside each test
file (self-documenting; not duplicated here to avoid drift).

## Genuine defect found via this suite

None directly (the property suite's role in this initiative was primarily
confirmatory, running *after* NUM-DEC-001/002 were already found and fixed
via the differential suite) — but property P17 specifically required
retargeting its "refresh" trigger from `settings.loadedHourlyRate` (which
doesn't flow through to a surface with its own rate override) to the paint
variant's `pricePerGal` (which does), during development — a test-
construction correction, not a production defect, caught by the property
itself failing to detect any change when the wrong field was mutated.

## Exit criteria

- Required properties covered: **25/25**
- Total seeded comparisons: **257,000** (exceeds the 250,000 minimum)
- All seeds and run counts recorded for reproducibility: **confirmed above**
- Framework-level test count: **26** `it()` blocks (one property is split
  across two `it()` blocks in `hardening.property.test.ts` for clarity)
