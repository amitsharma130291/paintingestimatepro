# Coding-agent handoff

Implement Painting Estimate Pro from this v2.1 specification package in the existing Astro project. Treat it as the replacement for the earlier specs. Preserve the finished Mainline homepage design. Read README, CALCULATION_SPEC, DATA_CONTRACT, then all tool-specs before coding.

First report any actual contradictions or missing decisions you find; do not invent financial assumptions. Implement in vertical stages:
1. Typed decimal-based core and structured validation. Port the acceptance fixtures and test them against production functions; do not merely rerun the supplied Python oracle.
2. Draft/project persistence, snapshots, immutable issued revisions, and restore transaction contracts.
3. Business catalog, surfaces, summary and service health, including per-surface material selection, trim widths, door sides and manual measured jobs.
4. Customer output, confirmed actuals, and backups.
5. Three free tools with their documented launch boundaries and shared formulas.
6. Actual purchase integration only after provider architecture is selected; follow ACCESS_SPEC. Never label a mock unlock production-ready.

Use static Astro marketing pages and focused interactive components for tools. No CRM, scheduling, AI, tax lookup, account system, or extra tools. Do not update original estimate snapshots from live settings during autosave. Keep private customer/project data out of analytics.

Each stage must pass relevant numeric AND behavioral acceptance cases. Verify negative-margin, incomplete-room, mixed-product, cents-rounding, issued-history, partial-actual, and repeated-restore cases. Check actual browser persistence and PDFs, not only unit tests. Provide runnable commands, changed files and limitations; do not claim acceptance on unexecuted tests. Do not deploy unless requested.

Final review corrections: preserve negative actual profit/margin whenever baselinePrice > 0; zero baseline price has undefined margin. Keep homepage values explicitly illustrative under CALCULATION_SPEC.md; do not tune defaults to fit them. Run the added loss and zero-price actual fixtures against production code as well as the oracle.
