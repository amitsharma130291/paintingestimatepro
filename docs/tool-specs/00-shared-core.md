# Shared core — v2.1
The complete authoritative contract is ../CALCULATION_SPEC.md. Do not duplicate a safe()-to-zero helper.

Public engine operations:
- validate inputs -> structured complete/incomplete/invalid result with field paths.
- derive room geometry and surface paintable areas.
- aggregate raw paint demand by snapshot variant, then compute whole-gallon purchases.
- compute application and additional labor, supplies, expenses, overhead.
- compute margin/status and target prices.
- compute service consumption unit costs independently of purchasing increments.
- compute document ledger (free template) with cent-rounded line totals.

All operations are deterministic, have no persistence/network side effects, and take explicit inputs/snapshots. Tool views never reimplement formulas. Null price, zero price, invalid assumptions, and losses are separate cases. Engine throws only for programming faults; user validation returns structured errors. Tests must exercise direct engine calls as well as UI guards.
