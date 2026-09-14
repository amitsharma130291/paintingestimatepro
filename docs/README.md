# Painting Estimate Pro — Implementation specifications v2.1

Status: revised implementation contract, not an implemented or tested application.
Prepared 2026-09-14 from the user-supplied business brief and tool-logic ZIP.
This package REPLACES v2.0 and the earlier calculation and per-tool documents. Documentation version is 2.1; persisted schemaVersion remains 2 because this revision makes no data-schema changes. Do not merge conflicting old rules into these files.

## Authority and reading order
1. CALCULATION_SPEC.md: authoritative formulas, units, validation, rounding, and defaults.
2. DATA_CONTRACT.md: authoritative persisted entities and lifecycle.
3. tool-specs/00 through 10: tool-specific inputs, outputs, and behavior; they reference the above contracts.
4. ACCEPTANCE_TESTS.md and acceptance-fixtures.json: numerical and behavioral implementation gates.
5. IMPLEMENTATION_PROMPT.md: coding-agent handoff.
6. ACCESS_SPEC.md: purchase/access boundary; provider selection remains a separate implementation task.

Where details appear in more than one file, the first two contracts govern. Raise a discrepancy instead of guessing.

## Launch scope
Paid: editable business assumptions, material catalog, multi-room/per-surface estimates, service rates and Price Book Health, customer document, estimate revisions, actuals, backup/restore.
Free: manual estimate template; job-cost calculator; single-room interior calculator with explicit limitations.
Pro supports walls, ceilings, trim, and doors, including standalone measured surfaces. Free interior covers walls and optional ceiling with one selected paint variant, not trim/door painting or a multi-room project. Describe it as a single-room estimator. This is an explicit launch reduction from the original broader free interior spec.
Later: exterior, invoice, standalone quantity, commercial-specific calculator, metric, irregular geometry automation, tax automation, CRM, scheduling, AI, accounting. Door/window opening deductions are not the same as painting those objects.

## Decisions finalized here
- US dollars, feet, square feet, gallons; percentages stored as decimal ratios with Ratio suffix.
- Invalid or missing required inputs block final results; never silently turn invalid values into zero.
- Exact decimal arithmetic for financial/quantity calculations; nearest-cent HALF_UP for documents. No arbitrary floating-point epsilon in purchasing.
- Whole gallons by variant in v1, with raw demand also shown. This is a product assumption, not a statement that smaller paint containers do not exist.
- Real project materials use purchased quantity; service health uses fractional consumption. Differences are disclosed.
- Per-surface paint variant, coats, and production assumptions. Trim width and door sides/area are explicit.
- Issued estimates are immutable revisions; drafts preserve selected snapshots unless explicitly refreshed.
- Actual categories distinguish missing from verified zero. Partial records do not show final profit.
- Import-as-copy and restore/merge are separate modes; no silent overwriting.
- No production rate, paint cost, or sample margin is asserted as an authoritative industry rate.

## Files
All eleven original tool documents have revised counterparts. DATA_CONTRACT.md adds missing data rules. Acceptance fixtures have independently checked numerical expectations; verify_reference.py checks those fixture calculations with exact rational arithmetic. This is an independent arithmetic oracle, NOT production implementation or proof of app behavior.

Run: python3 verify_reference.py

Implementation gate: satisfy the numeric fixtures and behavioral cases, then test the actual browser, printing, persistence, and purchase flow. No source application was supplied or changed.

## Final review status
Clarified actual-margin denominator guard; finalized illustrative-homepage policy without changing defaults; added negative-actual and zero-price regressions. The 20 numerical fixtures check 106 expected fields. No production application or behavioral tests are claimed to pass. FINAL_LOGIC.md consolidates the normative and supporting Markdown documents for convenient reading; the JSON fixtures and Python checker are separate files in this package.
