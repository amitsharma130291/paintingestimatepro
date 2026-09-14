# Deliberate fault checks: prove tests can fail

Temporarily inject each fault on an isolated test branch, verify the mapped suite fails, then revert. Do not ship mutants.

| Fault | Tests that must fail |
|---|---|
| Divide cost by1+margin instead of1-margin | NUM-door-homepage, CORE at-target/inverse properties |
| Round target price nearest instead of upward for suggestion | NUM-wall-service, minimum-cent guarantee |
| Clamp negative profit to0 | NUM-loss, NUM-actual-final-loss, ACT loss case |
| Gate actual margin on profit>0 | NUM-actual-final-loss |
| Convert null price to0 | NUM-unpriced vs NUM-no-charge |
| Apply percentage conversion twice | CORE percent-boundary case |
| Ceil paint per room | NUM-pool-same-product, pooling/split properties |
| Pool different colors | NUM-separate-colors |
| Subtract epsilon from all raw demands | NUM-exact-purchase-boundaries |
| Use wall throughput for ceiling | NUM-interior-with-ceiling |
| Omit door sides or multiply twice | NUM-door-two-faces |
| Treat trim length as square feet | NUM-trim-surface |
| Apply supplies percent to all materials | COST allowance tests |
| Include stale inactive mode inputs | JOB and COST mode-switch cases |
| Copy live rates into snapshot on save | CAT/LIFE rate42-to49 cases |
| Mutate issued revision in place | LIFE revision cases |
| Infer actual completeness from sum>0 | ACT partial/zero cases |
| Round subtotal only in manual document | NUM-document-rounding |
| Export raw entire estimate as customer DTO | DOC allow-list/property tests |
| Match imported records by name/price | BACK catalog collision cases |
| Write import incrementally outside transaction | BACK rollback/property tests |
| Unlock Pro from success query or local flag | ACCESS first two cases |
