# Implementation acceptance tests — v2.1

## Numerical fixtures
`acceptance-fixtures.json` contains fixed expected results. `verify_reference.py` independently checks them using exact rational arithmetic so binary rounding cannot distort an expected result. Run `python3 verify_reference.py`.
Production tests MUST call production functions with equivalent inputs and assert these expectations. Do not treat the oracle passing as evidence that an app exists or passes.
Fields expressed to six decimals are rounded observations, not inputs to a later formula. Preserve exact source decimals in production. Production input percentages are ratios.

Fixture coverage: original brief and homepage job costs; door margin; loss; at-target; missing and zero price; target-rounding boundary; room walls/ceiling; document cent rounding; same/different variant pooling; exact gallon boundaries; a forward-derived wall service; trim width; two-sided doors; final actual comparison.

Additional numeric integration gates:
- Same product, room A area100 coats1 + room B area100 coats3, waste0 coverage100: raw4 gallons, buy4. Do not apply one global coat count.
- Same product area100 coats1 waste0 + area100 coats1 waste.20, coverage100: raw2.2, buy3. Waste applies per surface before grouping.
- Quick door20 vs detailed3*6.67=20.01: preserve the difference, never force equality.
- Prep2 hours at$32 adds$64 labor exactly once; overhead.15 adds$9.60 when other values fixed.
- Travel50 creates direct expense50 and overhead7.50 at.15 once; autosave/duplicate/recalc never append a second default travel line.
- Raw cost component0.005 twice: displayed components.01+.01, raw total display.01, rounding-adjustment row-.01. Free document lines use their separate rule and total.02.
- Service currentPrice1.23 and modeled cost.794266666...: status above_target for35%, regardless of one-decimal percentage display. Approx target1.22 is not the minimum-cent1.23.

## Validation and state gates
V01 missing labor rate with enabled labor -> incomplete; no final cost/margin/issue.
V02 negative amount, NaN, infinity, "12abc", blank required value -> error/missing state; no silent zero.
V03 explicit zero expense is valid; zero proposed price means no-charge, not missing; zero divisor invalid.
V04 target ratio1 or negative invalid; large required price returns out_of_supported_range; engine returns no Infinity.
V05 openings exceeding walls -> invalid priced result, not valid zero-area room.
V06 disabled ceiling ignores its missing throughput; enabling it requires valid assumptions.
V07 disabled surface may retain draft data but never contributes; enabled coats0 invalid.
V08 half-entered room leaves project incomplete despite valid other rooms; no green margin status.
V09 change labor/material/overhead modes -> only newly active inputs contribute.
V10 actuals: confirm materials700 alone -> recorded cost700, no final profit/margin. Confirm other categories including explicit zeros to finalize.
V11 service missing selected variant, trim width or production -> incomplete row, not healthy low cost.
V12 free template described row with blank quantity -> incomplete and blocks priced output; untouched empty row ignored.
V13 no active surfaces -> no issueable Pro estimate even with a retained custom selling price.

## Persistence and lifecycle gates
D01 create draft at paint42, edit catalog49, autosave/reopen -> draft remains42; new draft49; explicit refresh changes draft after confirmation.
D02 issue revision, edit/delete room -> new draft revision; old inputs, rates, computed outputs and printed customer document unchanged.
D03 delete live paint variant -> saved draft/issued snapshot still calculates/displays; live service linked to deleted variant becomes incomplete.
D04 custom price survives cost changes; suggested mode refreshes minimum-cent price; no price change without correct mode.
D05 save actual review -> baseline issued fields byte-identical; no mutation of its recorded output.
D06 engine upgrade -> old issued output displays unchanged; explicit recalculation creates new draft revision.
D07 duplicate project -> unique IDs, independent nested objects, correct remapped links, no copied issued/actual state.
D08 export/import -> all revision snapshots and actual baseline references preserved; deleted live variants still display through snapshot.
D09 repeat identical restore -> zero duplicates; locally edited conflict -> prompt, default keep local.
D10 repeated import-as-copy -> skip by provenance unless explicit another copy requested; source actual baseline maps to copied issued revision.
D11 failed/truncated/invalid version/dangling reference/duplicate ID/oversized import -> no writes.
D12 quota or transaction failure -> previous committed store intact; UI never claims success.
D13 conflicting catalog IDs on import -> explicit resolution/remap; name+price never used as identity.

## Customer output and browser gates
P01 new private field added to engine -> absent from document allow-list and exported PDF.
P02 long names, many rooms, notes, missing logo -> no clipped totals or missing scope; inspect multipage print/PDF.
P03 unset price -> draft price pending; explicit zero issued only with no-charge confirmation; pre-tax notice visible.
P04 document line rounding and tax reconcile to displayed total exactly.
P05 script-like text in names/notes renders as literal text; logo format/size validation rejects unsafe payloads.
P06 reload, mobile layout, keyboard, focus, decimal input, local-storage failures, and backup recovery tested in actual browsers.
P07 confirm free tools deliver complete useful answers without payment; Pro handoff preserves compatible explicit inputs but does not falsely grant entitlement.

## Release gates
All numerical checks plus relevant validation/data/browser tests must pass in production code. Payment success/cancel/failure/recovery/idempotency tests are required under ACCESS_SPEC.md and are not covered by the arithmetic oracle. Document test commands/results; do not mark unexecuted scenarios passed.

## Final review regression gates
- actual-final-loss: finalized cost exceeds positive baseline selling price; retain negative profit AND negative margin.
- actual-zero-price: finalized cost with confirmed zero-price baseline; retain loss, return null margin, never divide by zero.
- Missing baseline price: invalid issued baseline; no final comparison.
- Marketing illustration remains labeled illustrative; no claim that homepage values were generated by the configured engine. A real screenshot must use the actual outputs of its recorded assumptions.
Numeric oracle coverage does not execute V01–V13, D01–D13, or P01–P07. Those 33 behavioral gates, the additional regression gates, and payment tests must be implemented and run separately.
