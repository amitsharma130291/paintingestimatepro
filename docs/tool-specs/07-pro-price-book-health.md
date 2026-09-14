# Pro Price Book Health — v2.1

Inputs: ServiceDefinition records, current paint variants, current overheadRatio and targetMarginRatio. Per-service fields supply coats, paint consumption geometry, labor assumptions, additional labor, supplies, and direct expense allocations. See core section 8 for complete derivation.

Outputs per row:
- Current selling price/unit (nullable).
- Paint consumption, supplies, labor, direct expenses, and overhead per unit.
- Modeled cost/unit and estimated profit/unit.
- MarginRatio and below_cost/below_target/at_target/above_target/unpriced/zero_price/incomplete status.
- Approximate target price and minimum cent price meeting target.
- Assumptions breakdown including product/color, coverage, coats, waste, surface dimensions, production units, overhead basis, and manually allocated expenses.

No whole-gallon rounding per unit. Clearly disclose consumption-cost basis and project purchasing/setup differences. A blank required service assumption produces incomplete, not a low or zero cost. Null price prompts entry; zero price identifies no-charge pricing; losses are retained.

Recalculate current health when material price, overhead, target, or explicit service fields change. Show material-price before/after comparison only against a captured prior service calculation; old issued estimates remain untouched. Live table is not populated with hardcoded homepage costs.

Example fixture: wall $1.80/ft², two coats, paint $42/350 coverage, waste.10, production150, labor$32, overhead.15, no extra allocations. Consumption cost .264/ft²; labor .426666...; modeled cost .794266666...; margin55.874074...%; display55.9%. This is a complete forward-derived example, not the homepage42.2% sample.

Marketing policy: follow the final policy in CALCULATION_SPEC.md. Existing homepage values are illustrative, not default-engine outputs. Never reverse-engineer business assumptions to reproduce them. Real product previews must use a complete saved example and its actual results.
