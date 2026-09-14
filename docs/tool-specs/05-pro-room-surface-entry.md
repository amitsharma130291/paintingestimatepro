# Pro room and surface entry — v2.1

Inputs: Room and Surface records from ../DATA_CONTRACT.md. Each surface independently chooses enabled state, material variant, coats, waste, labor assumptions, and appropriate measurements.
Room-derived walls and ceiling use geometry. Manual wall/ceiling area, direct trim length/developed width, and door dimensions/count/sides can exist without a room. This supports door-only/trim-only jobs.
Openings can be quick or measured and deductions optional. Doorway count never implies doors painted. Automatic casing/baseboard measurement is out of v1: request user-measured trim length. Preparation tracked through named additionalLabor lines, not hidden application multipliers.

Outputs: per-surface net quantity and coat-adjusted paintable area, raw gallons, labor hours; per-variant project demand/purchases; aggregate totals consumed by summary.
Aggregate raw demand once across all surfaces sharing snapshot variant, including different coats/waste. Never combine linear feet or door counts with square feet directly. Separate colors buy separately.

Incomplete enabled surface marks entire priced estimate incomplete. A partial subtotal may be shown clearly, but final margin/issue is blocked. Disabling/removing a draft surface recalculates draft. Altering an issued surface creates a new draft revision.
Stable IDs survive reorder/rename. Copying/removing surfaces updates references, not array-position identities. Existing snapshot variants remain valid even if live catalog deletes them.
