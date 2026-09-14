# v2.1 final review changes
- Explicitly gate actual margin on baselinePrice > 0, regardless of profit sign.
- Preserve loss amount and null margin on explicit zero baseline price; reject missing issued baseline price.
- Finalize homepage sample figures as illustrative, without tuning defaults to match.
- Add two actual-review numerical regressions; keep production/behavioral validation separate.
- Documentation version changes to 2.1; persisted schemaVersion remains 2.

# v2.0 changes from the originally uploaded package
- Replaced silent safe-to-zero policy with typed missing/invalid/zero states.
- Standardized decimal strings and stored ratio fields.
- Defined nearest target price versus upward-to-cent minimum meeting target.
- Split internal high-precision cost math from cent-rounded document arithmetic.
- Added per-surface variants/coats, trim developed width, door sides/geometry/time, prep lines, and standalone surfaces.
- Restored exact 20/15 ft² quick opening defaults and optional deductions.
- Added missing travel, waste, supplies, color/sheen, and service-model inputs.
- Defined Price Book Health as consumption-based, with explicit direct expense allocation; removed claims that reverse-solving homepage values proves the model.
- Added immutable issued revisions, explicit rate refresh and engine-version history.
- Separated partial actuals from complete profit review.
- Replaced contradictory import-new/upsert rules with defined import modes, provenance, graph remapping and transactions.
- Restored itemized free job-cost inputs; documented single-room free interior launch reduction.
- Added customer pre-tax output boundary and actual-revenue limitation.
- Added acceptance fixtures, numerical oracle, lifecycle tests and purchase-access gate.
