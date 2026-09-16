# Differential fixture and seed summary

Numerical-hardening initiative. Generator: `docs/generate_fuzz_fixtures.py`.
Executable comparison: `tests/differential/oracleFixtures.test.ts` (7
tests, DIFF-01 through DIFF-07). Fixtures are deterministic — regenerable
byte-for-byte from the recorded seed — and gitignored (~230MB total),
never committed.

## Seed and category counts

Recorded in `tests/fixtures/oracle-fuzz/manifest.json`:

```json
{
  "seed": 20260916,
  "counts": {
    "valid_project": 100000,
    "incomplete": 25000,
    "invalid": 25000,
    "boundary_adjacent": 25000,
    "loss_zero_unpriced": 10000,
    "price_book_health": 10000,
    "actual_cost": 10000
  },
  "total": 205000
}
```

Regenerate with:

```bash
python docs/generate_fuzz_fixtures.py tests/fixtures/oracle-fuzz --seed 20260916 --counts "valid_project=100000,incomplete=25000,invalid=25000,boundary_adjacent=25000,loss_zero_unpriced=10000,price_book_health=10000,actual_cost=10000"
```

Independently reproduced twice this session (once for the initial
fresh-extraction attempt, once for the corrected one) — both times the
regenerated `manifest.json` was byte-identical to the working tree's.

## What each category exercises

| Category | Count | Exercises |
|---|---|---|
| `valid_project` | 100,000 | The full `assembleProjectEstimate` pipeline on well-formed, individually-valid random projects — the main correctness surface. |
| `incomplete` | 25,000 | Missing-but-not-invalid inputs (blank required fields) resolve to `incomplete`, never a fabricated result. |
| `invalid` | 25,000 | Out-of-range or malformed inputs resolve to `invalid`, never a silently-clamped or coerced value. |
| `boundary_adjacent` | 25,000 | Inputs sitting exactly at, one unit below, or one unit above a documented engineering bound. |
| `loss_zero_unpriced` | 10,000 | Below-cost, zero-price, and unpriced pricing states. |
| `price_book_health` | 10,000 | `computeServiceUnitCost`/`evaluateServiceHealth` per-unit costing. |
| `actual_cost` | 10,000 | `evaluateActualReview`'s confirmed/unconfirmed category states and aggregate-range boundary. |

## Result

**0 mismatches across all 205,000 fixtures, all 7 categories**, after
fixing the two genuine production defects this suite found (NUM-DEC-001,
NUM-DEC-002 — full account in `NUMERICAL_BUG_FIX_LOG.md`).

`readNdjson()` (the fixture reader) was hardened this session to throw a
clear, actionable error on a missing or empty fixture file, rather than
silently returning `[]` and letting the comparison vacuously pass against
zero fixtures — discovered during fresh-extraction verification (see
`FRESH_EXTRACTION_VERIFICATION_LOG.md` and `NUMERICAL_BUG_FIX_LOG.md`).

## Exit criteria

- Fixtures generated: **205,000 / 205,000**
- Mismatches: **0**
- Reproducible from the recorded seed: **confirmed twice independently**
