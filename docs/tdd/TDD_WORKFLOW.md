# Practical TDD sequence

## Red → green → refactor
For each feature: choose its P0 cases, write assertions calling production interfaces, run and observe the expected failure, implement minimal correct behavior, rerun, refactor without changing outputs. A test failing because of missing tooling is not proof its business assertion can catch a defect. Never generate expected outputs from the same function under test.

1. Parser/state contract: CORE + BOUND, settled grammar/precision policies.
2. Geometry/material/labor: GEO+COST and numerical fixtures.
3. Price/summary/service health: CORE+PRO+HEALTH; test raw equality and cent boundaries.
4. Persistence/revisions: CAT+LIFE with deterministic clock/ID sources and real transaction integration tests.
5. Actuals/backup: ACT+BACK; inject failures before/at commit.
6. Free tools: TPL+JOB+INT, using already tested engine.
7. Customer documents: DOC+UX; inspect rendered multi-page output and assert private data absent.
8. End-to-end paid access: ACCESS once provider policies selected.

## Test data
Copy the frozen numerical fixtures for expected arithmetic. Build valid entity factories satisfying DATA_CONTRACT, then override exactly one field for an edge case. Factories need deterministic IDs/time, variant42 and variant49, one issued baseline3200/cost2185, actual review records, and backups with two linked projects. Do not fill a missing required field with a hidden factory default in a missing-input test.

For storage tests compare business/financial snapshots, not volatile timestamps. For PDF tests assert actual extracted customer content as well as a visual check. A screen snapshot alone cannot prove hidden private text is absent.

## Suite boundaries
- Unit: pure domain math, decimal parsing, validation, per-tool modes. No network/browser.
- Integration: actual local transaction layer, immutable revisions, serializers and import conflict orchestration. In-memory fakes alone do not prove browser persistence.
- Browser: fill controls, cause validation errors, reload, print, restore and inspect mobile/keyboard interaction.
- Provider integration: signed events, cancellation, recovery and duplicate delivery with official sandbox/testing mechanisms. Never charge a real customer to run routine CI.

## Whole-customer journeys
A. Free estimate: enter rows → invalid quantity → correct → duplicate → print; useful output without paywall.
B. Interior: enter original room → add ceiling → enable labor → inspect result → explore Pro without losing compatible inputs.
C. Pro: configure assumptions → create mixed-product room/trim/door project → review target → choose custom price → issue → edit catalog → reprint unchanged → record final loss → export → restore on empty store → same issued result/actuals.
D. Revision: issue → new draft → change room/rates → cancel refresh → confirm refresh → issue new revision → original actual baseline unchanged.
E. Purchase: checkout sandbox success → verified access → save estimate → recover access separately from data restore; URL tampering never unlocks.

## Recording and gates
Use RUN_RESULTS_TEMPLATE.csv. Populate commit, environment, actual result, status and evidence only after running. Allowed status: not_run, passed, failed, blocked. Record decision-required tests as blocked until policy resolves.
Required before launch: applicable P0 and browser acceptance pass; decisions resolved; no money/data-corruption/entitlement defects; arithmetic and relevant deliberate-fault checks demonstrate meaningful assertions. Do not use a line-coverage percentage as a substitute.

The supplied oracle checks20 numeric fixtures/106 fields only. It does not execute the named production test catalogue.
