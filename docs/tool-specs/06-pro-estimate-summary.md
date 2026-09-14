# Pro estimate summary — v2.1

Inputs: complete surface quantities and active RateSnapshot, itemized other materials, supplies allowance, additionalLabor, direct expenses including travel, priceMode, proposedPrice.
Outputs: raw/per-variant demand and purchases; material components; labor components; direct cost; allocated overhead; estimatedJobCost; approximateTargetPrice; minimumTargetPrice; selected proposedPrice; estimatedProfit; estimatedMargin; status; displayed rounding adjustment if needed.
All formulas are in ../CALCULATION_SPEC.md. Never fetch live settings during a saved-draft calculation unless explicit refresh occurred.

Suggested mode uses minimumTargetPrice (ceiling to cents), tracks valid input changes, and is labeled suggested. Manual edit switches to custom; later cost changes do not overwrite price. Explicit 'use target price' restores suggested mode. Incomplete surfaces disable final margin/issue even if custom price exists. Removing all surfaces yields no final priced job; preserve custom input but do not show a complete 100% margin.

Warn on cost changes after selecting a custom price and expose old/new cost. Keep negative profit. Missing versus zero price follows core states; all-zero quoted jobs require explicit no-charge confirmation.
Saving persists a draft; issuing freezes a revision including computed and customer-facing output. Changing rates is an explicit operation, not a side effect of saving. Taxes not modeled in Pro v1; label price pre-tax.
