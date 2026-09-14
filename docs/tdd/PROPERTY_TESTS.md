# Property-based tests

Generate bounded rational/decimal inputs within v2.1 ranges. Use a fixed seed in CI and print seed + minimized failing example. Avoid arbitrary float tolerances on money/status; use exact decimal or rational reference arithmetic. Precision-display assertions follow their explicit formatting rule.

1. Margin inverse: cost>=0,0<=target<1,positive exact requiredPrice -> (price-cost)/price=target; exclude cost0/price0 undefined case.
2. Minimum-cent guarantee: positive cost and valid supported target -> margin(minimumCent,cost)>=target; if price-.01>0, that previous cent must fail target.
3. Price monotonicity: at fixed positive cost, increasing positive selling price cannot decrease margin.
4. Cost monotonicity: fixed positive selling price, increased cost cannot increase profit/margin.
5. Required-price monotonicity: increased cost or target cannot reduce required price, within supported range.
6. Project pooling: permutation of rooms/surfaces leaves raw demand/purchases/cost unchanged.
7. Same-variant split invariance: splitting area across surfaces with same coats/waste/rates leaves project totals unchanged.
8. Pooling inequality: sum individual ceilings >= ceiling summed demand for the SAME variant; never apply across different variants.
9. Gallon bound: raw>=0 -> integer purchase>=raw and purchase<raw+1, except equality still satisfies upper bound.
10. Opening deduction: for deductions between0 and gross, net=gross-deduction; beyond gross invalid rather than a valid negative/zero final result.
11. Application labor linearity: at fixed rates, doubling valid area/length/count doubles raw hours; whole-gallon material purchases are NOT generally linear.
12. Coats/waste monotonicity: increasing either cannot decrease raw demand; purchasing is nondecreasing stepwise.
13. Variant independence: changes to variantA leave variantB quantities unchanged; shared overhead totals may change.
14. Disabled-input independence: changing inactive mode/surface values does not alter active results or final validity.
15. Ledger reconciliation: sum rounded line cents+rounded tax equals document total exactly.
16. Cost-display reconciliation: displayed components+rounding adjustment equals displayed total; adjustment never modifies raw model.
17. Issued immutability: any sequence of live catalog edits leaves frozen financial/customer payload unchanged.
18. Actual isolation: random valid actual edits do not modify baseline financial payload; replacing amount twice never accumulates.
19. Restore idempotence: importing same identical backup twice in restore mode leaves same business graph.
20. Copy independence: mutate any copied nested field -> source graph remains unchanged; links point to copied owners.
21. Atomicity: inject failure at each storage step -> pre-commit state remains identical or full transaction succeeds, never partial.
22. Privacy allow-list: adding arbitrary extra private fields to source estimate cannot expose them in customer DTO/PDF.
23. Import round-trip: export valid store, restore empty store -> semantic business equivalence; ignore export IDs/timestamps legitimately generated during export.
24. Numeric serialization: accepted decimals round-trip without nonfinite JSON or changed mathematical value.

Run quick bounded samples on every relevant change; larger seeded batches when modifying arithmetic, identity or migration logic. No claim of exhaustive coverage from a random run.
