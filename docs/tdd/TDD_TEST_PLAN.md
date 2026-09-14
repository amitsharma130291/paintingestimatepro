# Painting Estimate Pro — Comprehensive TDD test catalogue

Targets final logic v2.1. These are specified test cases, not a claim the production app passes. Coverage includes arithmetic, domain validation, each free/paid tool, lifecycle, imports, documents, browser usability and paid access. No finite suite proves absence of every possible defect.

Every case has a stable ID, source, Given/When/Then, level and priority. **P0** blocks the affected feature/release; **P1** is a browser/UX acceptance requirement, not permission to ignore accessibility. Cases explicitly labeled proposed_hardening or decision_required must not silently redefine v2.1. Resolve these as listed in DECISIONS.md.

## Coverage counts

| Area | Cases |
|---|---:|
| Shared parsing and result state | 30 |
| Geometry and paint aggregation | 30 |
| Labor, expenses and supplies | 19 |
| Free estimate template | 17 |
| Free job-cost calculator | 15 |
| Free single-room interior calculator | 15 |
| Pro business settings and catalog | 12 |
| Pro surfaces and summary | 16 |
| Price Book Health | 17 |
| Pro customer output | 12 |
| Actual-cost review | 16 |
| Projects, revisions and local persistence | 14 |
| Backup, restore and conflict handling | 26 |
| Browser, accessibility and privacy | 13 |
| Purchase and entitlement integration | 12 |
| Fixed arithmetic regression | 20 |
| Boundary matrix | 61 |

**Total: 345 named cases.** Some cases specify parameterized variants; split them into separate test executions.


## Shared parsing and result state

### CORE-001 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Required loadedHourlyRate=null on enabled surface
- **When:** Validate and calculate
- **Then:** state=incomplete; field path identifies missing rate; no final cost/margin or issueable output.

### CORE-002 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Required cost field contains -1
- **When:** Validate directly at engine boundary
- **Then:** state=invalid; retain raw field text in UI; do not replace with zero.

### CORE-003 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Input values NaN, positive infinity, negative infinity (parameterized)
- **When:** Call validation directly, bypass UI
- **Then:** Reject each as invalid; persisted output contains no nonfinite number.

### CORE-004 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Input text 12abc, $12, 12ft, 1/2 (parameterized)
- **When:** Parse user numeric input
- **Then:** Reject each as malformed plain decimal; never parse prefix or mixed units.

### CORE-005 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Required input empty string or whitespace-only
- **When:** Parse then validate
- **Then:** Missing/incomplete rather than explicit numeric zero.

### CORE-006 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Optional omitted direct expense in new estimate
- **When:** Initialize model
- **Then:** Explicit zero default; same omission in actual category remains null/unconfirmed.

### CORE-007 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** User enters target 35 in percent UI
- **When:** Persist and calculate cost65
- **Then:** targetMarginRatio='0.35'; minimum price100.00; no double division by100.

### CORE-008 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Valid cost65,target.35,price100
- **When:** Calculate
- **Then:** profit35.00; margin35.0%; status at_target, not above_target.

### CORE-009 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Valid cost100,price85,target.35
- **When:** Calculate
- **Then:** profit-15.00; margin-17.6%; below_cost takes precedence over below_target.

### CORE-010 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Valid cost100,price=null
- **When:** Calculate
- **Then:** profit=null;margin=null;unpriced; no invented zero-percent warning.

### CORE-011 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Valid cost100,price0
- **When:** Calculate
- **Then:** profit-100.00;margin=null;zero_price; priced issue needs no-charge confirmation.

### CORE-012 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Valid cost0,price100
- **When:** Calculate
- **Then:** profit100.00;margin100.0%; no division by cost in margin formula.

### CORE-013 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Valid cost0,price0
- **When:** Calculate
- **Then:** profit0.00;margin=null; zero_price, not a NaN percentage.

### CORE-014 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Valid cost65.0001,price100,target.35
- **When:** Calculate then display
- **Then:** displayed margin35.0% but raw below_target; do not compare formatted percentages.

### CORE-015 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Valid cost64.9999,price100,target.35
- **When:** Calculate then display
- **Then:** displayed margin35.0% but raw above_target.

### CORE-016 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Valid cost1,target.40
- **When:** Solve price
- **Then:** nearest1.67, minimum1.67; price1.66 would be below target.

### CORE-017 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Wall service fixture cost.794266666...,target.35
- **When:** Solve price using exact source inputs
- **Then:** approximate1.22,minimum1.23; never prefill1.22 as target-meeting price.

### CORE-018 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Cost1,target.9999999999
- **When:** Solve price
- **Then:** out_of_supported_range; no issueable price, Infinity or crash.

### CORE-019 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Positive cost with target0
- **When:** Solve price
- **Then:** Required raw price equals cost; minimum cents rounds upward only when needed.

### CORE-020 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Malformed enums or object/array in numeric field
- **When:** Validate engine/import boundary
- **Then:** Structured invalid result; do not coerce to number or select arbitrary mode.

### CORE-021 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Input proposedPrice=12.005
- **When:** Validate selling total
- **Then:** Reject excess precision; do not silently round typed selling total.

### CORE-022 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Free manual unitSellingPrice=12.005
- **When:** Validate manual document row
- **Then:** Valid within four fractional digits; ledger rounds line total separately.

### CORE-023 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Two internal cost components .005,.005
- **When:** Format components and total
- **Then:** Two displayed .01 rows; raw total display.01; rounding adjustment-.01 reconciles.

### CORE-024 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Two manual document line extensions .005,.005
- **When:** Compute document ledger
- **Then:** Each rounds.01; subtotal.02; no internal-cost rounding adjustment rule applied.

### CORE-025 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Raw labor7.506666... at32/hour
- **When:** Compute and display
- **Then:** Labor240.21; displayed approximate7.51 does not feed back into cost.

### CORE-026 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Profit negative .005
- **When:** Format money HALF_UP
- **Then:** Display -.01, symmetric away-from-zero tie behavior.

### CORE-027 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Valid inputs then one field cleared
- **When:** Recalculate reactive result
- **Then:** Remove stale final result/status; show incomplete and retain other valid data.

### CORE-028 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Incomplete draft with valid partial subtotal
- **When:** Save and attempt issue
- **Then:** Draft saves; final issue blocked; partial subtotal explicitly labeled incomplete.

### CORE-029 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** All surfaces removed, custom price remains
- **When:** Recalculate
- **Then:** No complete priced estimate or healthy100% margin; retain custom entry for correction.

### CORE-030 · P0 · unit

Source: `CALCULATION_SPEC.md §§1,6,7` · Contract: specified

- **Given:** Decimal input 0.1 plus0.2
- **When:** Compute exact sum
- **Then:** Exactly0.3 internally; no binary float artifact enters subsequent ceiling/comparison.

## Geometry and paint aggregation

### GEO-001 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Room20x16x9
- **When:** Derive gross walls and ceiling
- **Then:** Walls648ft²; ceiling320ft².

### GEO-002 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Same room,2 quick doors20,3 quick windows15
- **When:** Deduct openings
- **Then:** Deduction85; net563ft².

### GEO-003 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Same room with deduction disabled
- **When:** Calculate walls
- **Then:** Net648; inactive opening values ignored even if stale invalid.

### GEO-004 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Detailed opening3x6.67,count1
- **When:** Calculate deduction
- **Then:** 20.01ft², not20.

### GEO-005 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Detailed windows3x5,count3
- **When:** Calculate deduction
- **Then:** 45ft²; count applied once.

### GEO-006 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Openings exactly equal gross wall area
- **When:** Calculate
- **Then:** Valid net0; no excessive-opening error; paint demand0 for that wall.

### GEO-007 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Openings exceed gross area by.01
- **When:** Calculate final project
- **Then:** Invalid; display-only clamped preview is not a final zero-area result.

### GEO-008 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Room length12.5,width10,height8
- **When:** Calculate gross
- **Then:** 360ft²; decimal feet retained.

### GEO-009 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Manual wall area563, no room dimensions
- **When:** Calculate valid standalone surface
- **Then:** Area563 accepted; no room geometry required.

### GEO-010 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Walls disabled, ceiling enabled
- **When:** Calculate
- **Then:** Only ceiling area/labor/materials count; irrelevant wall openings/rate do not block.

### GEO-011 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Two rooms same variant each raw1.2gal
- **When:** Aggregate purchase
- **Then:** Raw2.4; buy3, not4.

### GEO-012 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Two rooms different color variants raw1.2 each
- **When:** Aggregate purchase
- **Then:** Buy2+2=4; no pooling by shared product name.

### GEO-013 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Two variants same name/color but different sheen IDs
- **When:** Aggregate
- **Then:** Separate purchases by variant ID; no merge by name.

### GEO-014 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** One snapshot ID mapped to conflicting variant values
- **When:** Validate
- **Then:** Reject inconsistent identity; do not pick first/last rate silently.

### GEO-015 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Same variant areas100/100, coats1/3, coverage100,waste0
- **When:** Aggregate
- **Then:** Demand4gal; buy4.

### GEO-016 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Same variant areas100/100,coats1,waste0/.2,coverage100
- **When:** Aggregate
- **Then:** Demand2.2gal; buy3.

### GEO-017 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Raw demand exactly3
- **When:** Purchase
- **Then:** 3gal.

### GEO-018 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Raw demand2.9999999999
- **When:** Purchase
- **Then:** 3gal, no epsilon rule.

### GEO-019 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Raw demand3.0000000001
- **When:** Purchase
- **Then:** 4gal, no epsilon suppression.

### GEO-020 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Zero raw demand
- **When:** Purchase
- **Then:** 0gal, no minimum1-gallon charge.

### GEO-021 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Coverage350,area350,coats1,waste0
- **When:** Calculate through production path
- **Then:** Exactly1gal despite quotient implementation; no manufactured rounding noise.

### GEO-022 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Two enabled surfaces same room wall/ceiling different variants
- **When:** Calculate
- **Then:** Use each surface's own coverage, coats and price; pool only compatible IDs.

### GEO-023 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Disabled surface with retained values
- **When:** Calculate
- **Then:** No contribution; no validation of inactive measurement fields.

### GEO-024 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Trim length100,developed width.5
- **When:** Derive paintable area
- **Then:** 50ft², not100ft² or100 doors.

### GEO-025 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Door count1,width3,height7,sides2
- **When:** Derive area
- **Then:** 42ft²; edges excluded explicitly.

### GEO-026 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Door count2,width3,height7,sides1
- **When:** Derive area
- **Then:** 42ft²; geometry correct independently of opening count.

### GEO-027 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Two doorway openings but doorsToPaint1
- **When:** Calculate surfaces
- **Then:** Deduct two openings and paint one door only.

### GEO-028 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Door surfaces with different sizes
- **When:** Aggregate
- **Then:** Sum independently derived area/demand; do not average hidden dimensions.

### GEO-029 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Surface input reordered/renamed
- **When:** Recalculate
- **Then:** Same totals and IDs; no dependence on index.

### GEO-030 · P0 · unit

Source: `CALCULATION_SPEC.md §§2–4; tool-specs/05` · Contract: specified

- **Given:** Surface split into two pieces same variant/rates
- **When:** Recalculate
- **Then:** Same raw demand, project purchase and cost; no per-piece ceiling.

## Labor, expenses and supplies

### COST-001 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Walls563,2coats,throughput150,rate32
- **When:** Compute labor
- **Then:** Hours1126/150; cost240.213333...; display240.21.

### COST-002 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Ceiling320,2coats,throughput120,rate32
- **When:** Compute labor
- **Then:** Hours16/3; cost170.666666...; display170.67.

### COST-003 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Both preceding surfaces
- **When:** Sum raw labor
- **Then:** Exactly12.84hours;410.88 cost.

### COST-004 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Trim100ft,2coats,throughput40,rate32
- **When:** Compute labor
- **Then:** 5hours;160.00; developed width affects paint, not throughput units.

### COST-005 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Door1,sides2,coats2,time.75,rate32
- **When:** Compute labor
- **Then:** 3hours;96.00; multiply by sides once.

### COST-006 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Same door with sides1
- **When:** Compute labor
- **Then:** 1.5hours;48.00; no implicit second side.

### COST-007 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Additional prep2hours,rate32
- **When:** Add to estimate
- **Then:** Labor increases64; at overhead.15 total cost increases73.60.

### COST-008 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Two labor lines with different loaded rates
- **When:** Calculate
- **Then:** Sum each hours*own rate; never multiply total hours by one arbitrary rate.

### COST-009 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Paint126,itemized supplies20,allowance none
- **When:** Calculate materials
- **Then:** 146.00; no hidden default allowance.

### COST-010 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Paint126,itemized supplies20,allowance flat10
- **When:** Calculate materials
- **Then:** 156.00; allowance shown separately.

### COST-011 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Paint126,itemized supplies20,allowance paintPercent.10
- **When:** Calculate materials
- **Then:** 158.60; allowance12.60 based on paint only, not all materials.

### COST-012 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Switch allowance flat10 to none while old ratio.10 retained
- **When:** Recalculate
- **Then:** Neither old flat nor ratio contributes.

### COST-013 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Switch allowance flat10 to paintPercent.10,paint126
- **When:** Recalculate
- **Then:** 12.60 allowance only; no22.60 blend.

### COST-014 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Travel default50
- **When:** Create new draft, autosave and recalculate repeatedly
- **Then:** Exactly one expense50; overhead7.50 at.15 on that expense.

### COST-015 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Existing draft travel line changed to75
- **When:** Recalculate
- **Then:** Keep75; no second50 default expense.

### COST-016 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Supplies line quantity3,unit cost2.50
- **When:** Calculate
- **Then:** 7.50 added once.

### COST-017 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Loaded rate already includes burden
- **When:** Calculate without explicit additional expense
- **Then:** No automatically added burden multiplier beyond selected overhead allocation.

### COST-018 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Direct cost100,overhead0
- **When:** Calculate
- **Then:** Total100; zero overhead valid.

### COST-019 · P0 · unit

Source: `CALCULATION_SPEC.md §5` · Contract: specified

- **Given:** Direct cost100,overhead1
- **When:** Calculate
- **Then:** Overhead100,total200; warning unusual, not invalid.

## Free estimate template

### TPL-001 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** Empty new template with untouched row
- **When:** Attempt priced print
- **Then:** Block until a described valid row; no blank priced document.

### TPL-002 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** One untouched empty row plus valid row1x100
- **When:** Calculate
- **Then:** Ignore untouched row;subtotal100.

### TPL-003 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** Description entered but quantity blank
- **When:** Calculate/print
- **Then:** Incomplete; priced output blocked; not silently quantity0 or1.

### TPL-004 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** Quantity/price entered but description blank
- **When:** Calculate/print
- **Then:** Incomplete row; not excluded from print while included in total.

### TPL-005 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** One line2x12.50
- **When:** Calculate
- **Then:** Line/subtotal25.00.

### TPL-006 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** Two lines1x12.005,tax10%
- **When:** Calculate document
- **Then:** 12.01 each;subtotal24.02;tax2.40;total26.42.

### TPL-007 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** One line3x.3333
- **When:** Calculate
- **Then:** Extension.9999 ->1.00; subtotal1.00.

### TPL-008 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** Tax disabled with retained taxRatio.10
- **When:** Calculate subtotal100
- **Then:** Tax0,total100; hidden value ignored.

### TPL-009 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** Tax enabled ratio0
- **When:** Calculate
- **Then:** Valid tax0; no forced tax assumption.

### TPL-010 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** Tax ratio.25 and .2501 in separate cases
- **When:** Validate
- **Then:** .25 no unusual-rate warning; .2501 warning but valid up to1.

### TPL-011 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** Tax ratio1.01 or negative
- **When:** Validate
- **Then:** Invalid, not automatically reduced to allowed limit.

### TPL-012 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** Explicit quantity0 with described row and price100
- **When:** Print row
- **Then:** Row0.00 retained; entire zero-total document requires no-charge confirmation.

### TPL-013 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** Blank business/customer headers
- **When:** Print valid estimate
- **Then:** Allowed with neutral presentation; no undefined/null or fabricated identity.

### TPL-014 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** Duplicate estimate
- **When:** Edit duplicate line/header
- **Then:** Original unchanged; new IDs; estimate number cleared.

### TPL-015 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** Same description on two valid rows
- **When:** Calculate
- **Then:** Both independent lines counted; no deduplication.

### TPL-016 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** Currency/units text contains ft² or non-ASCII name
- **When:** Print
- **Then:** Characters retained legibly; no replacement artifacts.

### TPL-017 · P0 · integration

Source: `tool-specs/01-free-estimate-template.md` · Contract: specified

- **Given:** User prints without Pro entitlement
- **When:** Complete free document
- **Then:** Full useful print/PDF available; no access gate.

## Free job-cost calculator

### JOB-001 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** Untouched initial page
- **When:** Render
- **Then:** Guidance to enter/confirm costs; no apparently complete0.00 recommendation.

### JOB-002 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** User explicitly confirms all zero costs
- **When:** Calculate
- **Then:** Labeled zero-cost scenario allowed; distinguish from untouched.

### JOB-003 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** 42hours*32,22gal*42,supplies180,travel100,other75,overhead.15,target.35
- **When:** Calculate
- **Then:** Direct2623;overhead393.45;cost3016.45;approx4640.69;minimum4640.70.

### JOB-004 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** Materials620,labor1280,expenses0,overhead.15,enteredPrice3200
- **When:** Reverse calculate
- **Then:** Cost2185;estimated profit1015;estimated margin31.7%;review pricing.

### JOB-005 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** Materials mode lumpSum620 with stale itemized values
- **When:** Calculate
- **Then:** Materials620 only.

### JOB-006 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** Switch to itemized gallons2.5*42,supplies10
- **When:** Calculate
- **Then:** Materials115; no ceil to3 because input is purchased quantity.

### JOB-007 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** Labor direct100 while stale hours42/rate32
- **When:** Calculate
- **Then:** Labor100 only.

### JOB-008 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** Switch to hoursRate2*50
- **When:** Calculate
- **Then:** Labor100; direct prior value excluded.

### JOB-009 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** Direct cost200,overheadMode flat,amount30,stale ratio.15
- **When:** Calculate
- **Then:** Overhead30;cost230; no percentage addition.

### JOB-010 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** Switch overhead to percent.10
- **When:** Calculate
- **Then:** Overhead20;flat30 ignored.

### JOB-011 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** EnterPrice mode blank
- **When:** Calculate
- **Then:** Cost available; estimated profit/margin null; prompt for price.

### JOB-012 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** EnterPrice mode0 with positive cost
- **When:** Calculate
- **Then:** Negative estimated profit,undefined margin,zero-price status.

### JOB-013 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** Target100%
- **When:** Calculate engine directly and through UI
- **Then:** Invalid; never display Infinity or a target suggestion.

### JOB-014 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** User changes cost after valid result
- **When:** Recalculate
- **Then:** Output reflects current active inputs; no old result shown as current.

### JOB-015 · P0 · integration

Source: `tool-specs/02-free-job-cost-calculator.md` · Contract: specified

- **Given:** Free tool result labels
- **When:** Inspect
- **Then:** Estimated profit/margin, not actual; implied target price not market recommendation.

## Free single-room interior calculator

### INT-001 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** 20x16x9,doors2x20,windows3x15,walls only,2coats,coverage350,waste.1,paint42
- **When:** Calculate
- **Then:** Area563;coat1126;raw3.538857...;buy4;paint168.

### INT-002 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** Same room with ceiling enabled and rates150/120,labor32
- **When:** Calculate
- **Then:** Area883;raw5.5502857...;buy6;paint252;hours12.84;labor410.88;total662.88.

### INT-003 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** Same walls-only room with labor enabled
- **When:** Calculate
- **Then:** Hours7.506666...;labor240.21;paint168;total408.21.

### INT-004 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** Labor disabled with stale missing/invalid rate
- **When:** Calculate paint
- **Then:** Material result valid; label Paint materials only; no apparent full-job cost.

### INT-005 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** Enable labor with rate blank
- **When:** Calculate
- **Then:** Incomplete; request rate, no zero-labor final total.

### INT-006 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** Enable labor with explicit rate0
- **When:** Calculate
- **Then:** Allow labeled zero-rate scenario with warning; no divisor error.

### INT-007 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** Ceiling disabled with invalid ceiling throughput
- **When:** Calculate walls
- **Then:** Inactive ceiling throughput ignored.

### INT-008 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** Only ceiling enabled with no walls
- **When:** Calculate
- **Then:** 320ft²; no wall deduction/labor; clear ceiling-only scope.

### INT-009 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** Both wall and ceiling disabled
- **When:** Calculate
- **Then:** Incomplete/invalid no active surface; not a complete0 estimate.

### INT-010 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** Switch quick to detailed mode
- **When:** Enter one3x6.67 doorway
- **Then:** Detailed20.01 supersedes quick counts; no mixed deduction.

### INT-011 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** Disable deductions with retained excessive openings
- **When:** Calculate
- **Then:** Gross wall area used; ignore inactive openings.

### INT-012 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** Include ceiling with shared paint
- **When:** Inspect inputs/output
- **Then:** Explicit notice both surfaces use same variant; no claim of separate product selection.

### INT-013 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** Fresh defaults
- **When:** Inspect
- **Then:** Ceiling off;labor off;counts0;sample paint45 editable;labeled sample assumptions.

### INT-014 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** Add prep2hours at32
- **When:** Recalculate completed room
- **Then:** Labor adds64 exactly once; displayed exclusions still mention overhead/supplies/tax.

### INT-015 · P0 · integration

Source: `tool-specs/03-free-interior-calculator.md` · Contract: specified

- **Given:** User seeks multi-room or trim/door painting
- **When:** Inspect scope/help
- **Then:** Single-room limitation explicit; openings not labeled painted doors; no unsupported controls.

## Pro business settings and catalog

### CAT-001 · P0 · integration

Source: `tool-specs/04; DATA_CONTRACT.md` · Contract: specified

- **Given:** Fresh real-user setup
- **When:** Save incomplete settings
- **Then:** Labor/paint price not silently populated as real assumptions; priced issue blocked until configured/confirmed.

### CAT-002 · P0 · integration

Source: `tool-specs/04; DATA_CONTRACT.md` · Contract: specified

- **Given:** User accepts sample defaults
- **When:** Issue valid estimate
- **Then:** Confirmation recorded; labels do not claim industry-validated production rates.

### CAT-003 · P0 · integration

Source: `tool-specs/04; DATA_CONTRACT.md` · Contract: specified

- **Given:** Two paint variants same name, different colors
- **When:** Save/select
- **Then:** Distinct IDs and visible differentiation; separate purchase grouping.

### CAT-004 · P0 · integration

Source: `tool-specs/04; DATA_CONTRACT.md` · Contract: specified

- **Given:** Two variants same name and price, different coverage
- **When:** Import/select
- **Then:** Never merge by name+price; retain coverage distinctions.

### CAT-005 · P0 · integration

Source: `tool-specs/04; DATA_CONTRACT.md` · Contract: specified

- **Given:** Edit live paint42 to49 after draft creation
- **When:** Reopen/autosave draft
- **Then:** Draft retains42; new draft49; health reflects current49.

### CAT-006 · P0 · integration

Source: `tool-specs/04; DATA_CONTRACT.md` · Contract: specified

- **Given:** Rename live product after estimate issue
- **When:** Print old estimate
- **Then:** Snapshot unaffected; no historical output rewrite.

### CAT-007 · P0 · integration

Source: `tool-specs/04; DATA_CONTRACT.md` · Contract: specified

- **Given:** Delete live variant used by saved draft and live service
- **When:** View both
- **Then:** Draft resolves snapshot; live service incomplete until corrected.

### CAT-008 · P0 · integration

Source: `tool-specs/04; DATA_CONTRACT.md` · Contract: specified

- **Given:** Change default throughput after customized service created
- **When:** View service
- **Then:** Custom value unchanged; explicit refresh-defaults preview required.

### CAT-009 · P0 · integration

Source: `tool-specs/04; DATA_CONTRACT.md` · Contract: specified

- **Given:** Change current overhead or margin target
- **When:** View health and old estimate
- **Then:** Health refreshes; saved estimate retains snapshot values.

### CAT-010 · P0 · integration

Source: `tool-specs/04; DATA_CONTRACT.md` · Contract: specified

- **Given:** Edit supplies allowance defaults
- **When:** Create new and reopen old draft
- **Then:** New draft uses new mode; old draft retains prior allowance.

### CAT-011 · P0 · integration

Source: `tool-specs/04; DATA_CONTRACT.md` · Contract: specified

- **Given:** Catalog empty, enabled painted surface
- **When:** Calculate
- **Then:** Missing variant/coverage/cost prompts; no zero-material estimate.

### CAT-012 · P0 · integration

Source: `tool-specs/04; DATA_CONTRACT.md` · Contract: specified

- **Given:** Select unspecified color/sheen explicitly
- **When:** Save
- **Then:** Allowed explicit placeholder; no hidden pooling across separate IDs.

## Pro surfaces and summary

### PRO-001 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Room walls paintA42,ceiling paintB38 with own coverage/coats
- **When:** Calculate
- **Then:** Independent surface demand and purchase, summed costs; no room-wide product override.

### PRO-002 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Standalone trim100,width.5,2coats,350coverage,waste.1,paint42,rate32,throughput40
- **When:** Calculate
- **Then:** Area50;raw.3142857;buy1;paint42;labor160 before overhead/other costs.

### PRO-003 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Standalone door1,3x7,sides2,2coats,time.75,rate32
- **When:** Calculate
- **Then:** No room required;area42;hours3;labor96;edges excluded.

### PRO-004 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Door width missing but count1 enabled
- **When:** Calculate
- **Then:** Incomplete entire priced project; no hidden area assumption.

### PRO-005 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Trim width missing but length100 enabled
- **When:** Calculate
- **Then:** Incomplete materials/model; no linear-feet-as-area substitution.

### PRO-006 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Room valid walls plus incomplete enabled ceiling
- **When:** Calculate
- **Then:** Partial wall subtotal may show; final cost/margin/issue unavailable.

### PRO-007 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Disable incomplete ceiling
- **When:** Calculate
- **Then:** Remaining valid scope complete; no ghost ceiling in customer scope.

### PRO-008 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Custom proposedPrice3200, then cost increases
- **When:** Recalculate
- **Then:** Price remains3200; margin decreases; changed cost warning available.

### PRO-009 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Suggested mode, costs increase
- **When:** Recalculate
- **Then:** Suggested minimum-cent price updates; raw resulting margin meets target.

### PRO-010 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Custom mode -> choose use target price
- **When:** Recalculate
- **Then:** Switch to suggested; use minimum-cent price not nearest display.

### PRO-011 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** No active surfaces but retained expenses/custom price
- **When:** Attempt issue
- **Then:** Block per launch contract requiring enabled valid surface.

### PRO-012 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** No-charge project with valid scope/price0
- **When:** Attempt issue before/after confirmation
- **Then:** Block until explicit no-charge confirmation; then allow with undefined margin.

### PRO-013 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Project cost raw category cents mismatch
- **When:** Inspect summary
- **Then:** Explicit adjustment reconciles displayed components to displayed total; internal cost unchanged.

### PRO-014 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Drag rooms/surfaces into different order
- **When:** Save/reopen
- **Then:** Stable IDs and unchanged totals; display ordering only changes.

### PRO-015 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Remove room on issued estimate
- **When:** Confirm edit
- **Then:** New draft revision; original room/price/customer output remains frozen.

### PRO-016 · P0 · integration

Source: `tool-specs/05,06; DATA_CONTRACT.md` · Contract: specified

- **Given:** Explicit refresh current rates with missing deleted variant
- **When:** Apply refresh
- **Then:** Require replacement or retain snapshot variant; no name-based guessing.

## Price Book Health

### HEALTH-001 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Wall service full forward fixture42/350,coats2,waste.1,throughput150,rate32,overhead.15,price1.80
- **When:** Calculate
- **Then:** Paint.264;labor.426666...;cost.794266...;margin55.9%;approx1.22;minimum1.23.

### HEALTH-002 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Same service price1.22
- **When:** Calculate margin against raw cost
- **Then:** Below target35%;display34.9%; not labeled target meeting.

### HEALTH-003 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Same service price1.23
- **When:** Calculate
- **Then:** Above target; smallest cent price meeting35%.

### HEALTH-004 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Service consumption far below1gal
- **When:** Calculate cost per unit
- **Then:** No whole-gallon ceiling per unit; consumption pricing used.

### HEALTH-005 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Trim service width.5,length-unit1,coats2,rate40,loaded32,paint42/350,waste.1
- **When:** Calculate before overhead/allocations
- **Then:** Area/unit.5;paint/unit.132;labor/unit1.60; units remain linear ft.

### HEALTH-006 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Door service3x7,sides2,coats2,time.75,loaded32,paint42/350,waste.1
- **When:** Calculate before overhead
- **Then:** Paint/unit11.088;labor/unit96; no one-gallon42 material charge.

### HEALTH-007 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Service additionalHours.25,rate32
- **When:** Add per-unit labor
- **Then:** Cost adds8 direct plus overhead on8; only once.

### HEALTH-008 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Service directExpense10,overhead.15
- **When:** Calculate overhead increment
- **Then:** 1.50 allocation on expense; expense not omitted from overhead basis.

### HEALTH-009 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Project travel50 exists but service expense/unit0
- **When:** View service
- **Then:** No automatic50 added per service unit.

### HEALTH-010 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Service currentPrice null
- **When:** Calculate
- **Then:** unpriced; cost breakdown may display; no false below-target status.

### HEALTH-011 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Service currentPrice0
- **When:** Calculate
- **Then:** zero_price with loss amount and null margin; not unpriced.

### HEALTH-012 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Service sellingPrice below modeled cost
- **When:** Calculate
- **Then:** Negative margin and profit shown; below_cost takes precedence.

### HEALTH-013 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Coverage missing or selected variant deleted
- **When:** Calculate
- **Then:** Incomplete row; no flattering zero modeled cost.

### HEALTH-014 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Target changes .35 to.60
- **When:** Re-evaluate same wall service
- **Then:** Cost unchanged, status changes to below_target at current price1.80.

### HEALTH-015 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Live paint price changes42 to49
- **When:** Re-evaluate
- **Then:** Consumption cost increases; margin decreases; issued project unchanged.

### HEALTH-016 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** User expands row
- **When:** Inspect
- **Then:** Product/color,coverage,coats,waste,geometry,labor,overhead,allocations visible.

### HEALTH-017 · P0 · unit/integration

Source: `tool-specs/07; CALCULATION_SPEC.md §8` · Contract: specified

- **Given:** Homepage illustrative table remains42.2% wall
- **When:** Compare live fixture55.9%
- **Then:** No forced matching; marketing explicitly sample-only and live result remains correct.

## Pro customer output

### DOC-001 · P0 · browser/integration

Source: `tool-specs/08; CALCULATION_SPEC.md §6` · Contract: specified

- **Given:** Issued estimate with all internal cost fields
- **When:** Build customer DTO/PDF
- **Then:** Only allow-list fields passed; no loaded rates,costs,profit,margin,actuals or license data.

### DOC-002 · P0 · browser/integration

Source: `tool-specs/08; CALCULATION_SPEC.md §6` · Contract: specified

- **Given:** Add new secret/internal field to source estimate
- **When:** Generate document
- **Then:** Field absent by default; no reliance on a growing block-list.

### DOC-003 · P0 · browser/integration

Source: `tool-specs/08; CALCULATION_SPEC.md §6` · Contract: specified

- **Given:** Issued price1000
- **When:** Render scope with multiple descriptions
- **Then:** One exact project selling total1000.00; no invented distribution across descriptions.

### DOC-004 · P0 · browser/integration

Source: `tool-specs/08; CALCULATION_SPEC.md §6` · Contract: specified

- **Given:** Unpriced/incomplete draft
- **When:** Print scope preview
- **Then:** DRAFT and PRICE PENDING; never0.00 as assumed selling price.

### DOC-005 · P0 · browser/integration

Source: `tool-specs/08; CALCULATION_SPEC.md §6` · Contract: specified

- **Given:** Confirmed no-charge issued estimate
- **When:** Print
- **Then:** Explicit no-charge/zero price; not price pending.

### DOC-006 · P0 · browser/integration

Source: `tool-specs/08; CALCULATION_SPEC.md §6` · Contract: specified

- **Given:** Pro priced document
- **When:** Inspect total and notes
- **Then:** Pre-tax notice present; no automatic sales tax added.

### DOC-007 · P0 · browser/integration

Source: `tool-specs/08; CALCULATION_SPEC.md §6` · Contract: specified

- **Given:** Missing optional logo/business address/customer name
- **When:** Render
- **Then:** No broken icons,undefined/null strings or fabricated identity.

### DOC-008 · P0 · browser/integration

Source: `tool-specs/08; CALCULATION_SPEC.md §6` · Contract: specified

- **Given:** Long multi-room scope over several pages
- **When:** Print/PDF
- **Then:** Scope preserved,headers where appropriate,no clipped or overlapping totals; all pages inspectable.

### DOC-009 · P0 · browser/integration

Source: `tool-specs/08; CALCULATION_SPEC.md §6` · Contract: specified

- **Given:** Name or notes contains script/HTML-looking text
- **When:** Render
- **Then:** Literal safe text; no script execution or injected markup.

### DOC-010 · P0 · browser/integration

Source: `tool-specs/08; CALCULATION_SPEC.md §6` · Contract: specified

- **Given:** Logo script-capable payload or >1MiB
- **When:** Import/render
- **Then:** Reject unsafe/oversized asset; source state intact.

### DOC-011 · P0 · browser/integration

Source: `tool-specs/08; CALCULATION_SPEC.md §6` · Contract: specified

- **Given:** Issued snapshot created under earlier engine
- **When:** Print after engine upgrade
- **Then:** Frozen customer content/total unchanged; no automatic recalculation.

### DOC-012 · P0 · browser/integration

Source: `tool-specs/08; CALCULATION_SPEC.md §6` · Contract: specified

- **Given:** Customer preview and internal screen open
- **When:** Print customer document
- **Then:** Internal panels/buttons omitted; printable container selected correctly.

## Actual-cost review

### ACT-001 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** No actual categories confirmed
- **When:** Open review
- **Then:** In progress; no final cost/profit/margin/variance; missing indicators.

### ACT-002 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** Materials700 confirmed, others null
- **When:** Calculate
- **Then:** Recorded cost700 only; no final profit/margin or total variance.

### ACT-003 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** Materials amount0 confirmed
- **When:** Calculate progress
- **Then:** Zero counts as supplied, distinct from missing.

### ACT-004 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** All four amounts supplied but one unconfirmed
- **When:** Finalize
- **Then:** Block until every category confirmed.

### ACT-005 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** 700materials,1400labor,100expenses,285overhead,baseline3200/cost2185
- **When:** Finalize
- **Then:** Actual2485;profit715;margin22.3%;variance+300.

### ACT-006 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** 1000materials,2000labor,200expenses,300overhead,baseline3200/cost2185
- **When:** Finalize
- **Then:** Actual3500;profit-300;margin-9.4%;variance+1315; loss retained.

### ACT-007 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** Actual100,baseline price0
- **When:** Finalize valid no-charge baseline
- **Then:** Profit-100;margin=null; no divide-by-zero; not unpriced.

### ACT-008 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** Baseline proposedPrice missing
- **When:** Select/finalize
- **Then:** Invalid issued baseline; do not coerce to0.

### ACT-009 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** Baseline overhead285 defaults into review
- **When:** Inspect before confirmation
- **Then:** Labeled estimated/baseline allocation; not measured actual; must confirm.

### ACT-010 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** Switch baseline overhead285 to actualFlat300
- **When:** Calculate
- **Then:** Use300 only; no585 addition.

### ACT-011 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** Switch actual labor direct100 to hours2*rate60
- **When:** Calculate
- **Then:** Labor120 only; no stale100 accumulation.

### ACT-012 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** Final actual amount edited700 to750
- **When:** Recompute
- **Then:** Replace prior amount; cost changes50, not700+750.

### ACT-013 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** Record/save actuals against issued revision
- **When:** Compare baseline before/after
- **Then:** Original estimated fields and printed snapshot unchanged.

### ACT-014 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** New issued revision created later
- **When:** Open old actual review
- **Then:** Same baseline ID until explicit rebase action; no automatic revenue substitution.

### ACT-015 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** Negative actual expense entered
- **When:** Validate
- **Then:** Invalid; no silent zero/clamp and no finalization.

### ACT-016 · P0 · integration

Source: `tool-specs/09; DATA_CONTRACT.md` · Contract: specified

- **Given:** User asks about receipts/change orders
- **When:** Inspect labels
- **Then:** Profit is against original pre-tax quote; not cash received or actual revenue.

## Projects, revisions and local persistence

### LIFE-001 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: specified

- **Given:** Draft with rates42
- **When:** Change catalog49,autosave,reload
- **Then:** Draft42;no silent refresh from live settings.

### LIFE-002 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: specified

- **Given:** Draft refresh preview canceled
- **When:** Reopen
- **Then:** Original snapshot/output preserved.

### LIFE-003 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: specified

- **Given:** Draft refresh confirmed
- **When:** Save/reopen
- **Then:** New snapshot applied;pre-refresh recovery available; custom price stays custom.

### LIFE-004 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: specified

- **Given:** Issued revision edited
- **When:** Save draft
- **Then:** Original issued revision immutable; draft has fresh revision ID.

### LIFE-005 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: specified

- **Given:** New draft exists but not issued
- **When:** Inspect previous issued revision
- **Then:** Still issued baseline; not prematurely superseded.

### LIFE-006 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: specified

- **Given:** Issue new revision explicitly
- **When:** Inspect history
- **Then:** Prior marked superseded while original financial payload preserved; new active issued revision.

### LIFE-007 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: specified

- **Given:** Duplicate project
- **When:** Edit nested room/catalog snapshot
- **Then:** Original unchanged; new IDs,correct references,no actuals/issued document; number cleared.

### LIFE-008 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: specified

- **Given:** Reload after successful autosave
- **When:** Open project
- **Then:** Last committed draft restored,including snapshot and price mode.

### LIFE-009 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: specified

- **Given:** Storage write/quota failure
- **When:** Save
- **Then:** Previous committed data intact; UI says save failed,never saved.

### LIFE-010 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: specified

- **Given:** Engine version upgrade
- **When:** Open old issued document
- **Then:** Historical financial output unchanged; recalc only into new draft revision.

### LIFE-011 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: specified

- **Given:** Room renamed/reordered then reload
- **When:** Inspect references
- **Then:** Same surface/room IDs and correct owning relationships.

### LIFE-012 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: proposed_hardening

- **Given:** Two tabs concurrently edit same project
- **When:** Save from stale tab
- **Then:** Proposed hardening gate: no silent overwrite; conflict detection/reload/explicit overwrite policy required before enabling multi-tab editing.

### LIFE-013 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: specified

- **Given:** Interrupted issue transaction
- **When:** Restart app
- **Then:** Either prior state or complete issued revision; no half-issued record.

### LIFE-014 · P0 · integration

Source: `DATA_CONTRACT.md` · Contract: proposed_hardening

- **Given:** Delete project with actual/history
- **When:** Confirm deletion
- **Then:** Proposed hardening gate: clear destructive confirmation and atomic deletion of owned records only; other projects unaffected.

## Backup, restore and conflict handling

### BACK-001 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Projects with drafts,issued revisions,actuals,deleted-live snapshot variants
- **When:** Export then restore empty store
- **Then:** All business data/links/printed snapshots preserved; no live catalog dependency.

### BACK-002 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Valid backup contains paid token in current runtime only
- **When:** Export
- **Then:** Token/payment secrets/analytics IDs absent from envelope.

### BACK-003 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Identical backup restored twice
- **When:** Restore/merge
- **Then:** First adds; second skips identical IDs; no duplicates.

### BACK-004 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Local project changed after export, same incoming ID
- **When:** Restore
- **Then:** Conflict preview;default keep-local; no timestamp-wins overwrite.

### BACK-005 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Conflict choose replace-imported
- **When:** Commit
- **Then:** Explicit selected imported project graph replaces atomically; other projects unchanged.

### BACK-006 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Conflict choose keep-both
- **When:** Commit
- **Then:** New project graph IDs remapped; both preserved; actual baseline links resolve correctly.

### BACK-007 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Import as copies
- **When:** Commit
- **Then:** Fresh IDs for graph,including revisions/surfaces/actual links; snapshots self-contained.

### BACK-008 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Repeat same exportId/sourceProjectId as copies
- **When:** Import
- **Then:** Already-imported skip unless explicitly request another copy.

### BACK-009 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Locally edit imported copy then reimport same source
- **When:** Import
- **Then:** No silent upsert replacing local edits.

### BACK-010 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Replace-all canceled at preview
- **When:** Inspect store
- **Then:** No mutation.

### BACK-011 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Replace-all confirmed after backup offered
- **When:** Commit
- **Then:** Full atomic replacement; original recoverable through pre-import backup.

### BACK-012 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Corrupt/truncated JSON
- **When:** Import
- **Then:** Reject before writes; clear reason.

### BACK-013 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** SchemaVersion3 or unsupported1
- **When:** Import
- **Then:** Reject with compatibility message; no guessed migration.

### BACK-014 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Duplicate IDs inside one graph
- **When:** Validate
- **Then:** Reject ambiguous identity before writes.

### BACK-015 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Actual baseline ID points to missing revision
- **When:** Validate
- **Then:** Reject dangling reference.

### BACK-016 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Revision missing self-contained rates snapshot
- **When:** Validate
- **Then:** Reject; no lookup into live catalog to fill missing data.

### BACK-017 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Catalog same ID with different price/coverage
- **When:** Import merge
- **Then:** Conflict resolved explicitly; no name+price matching.

### BACK-018 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** File size25MiB plus1 byte
- **When:** Import
- **Then:** Reject before store mutation.

### BACK-019 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Logo size1MiB plus1 byte
- **When:** Import
- **Then:** Reject oversized embedded asset; no partial state.

### BACK-020 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Unknown enum,negative costs,nondecimal scalar in imported active financial data
- **When:** Import
- **Then:** Reject invalid schema/ranges; no silent coercion.

### BACK-021 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Transactional commit fails after some staged records
- **When:** Import
- **Then:** Rollback entire operation; record counts unchanged.

### BACK-022 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Quota exhausted during import
- **When:** Commit
- **Then:** No partial restore; clear failure and recovery guidance.

### BACK-023 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: proposed_hardening

- **Given:** Malicious prototype keys/script text in backup
- **When:** Parse/store/render
- **Then:** Proposed hardening: no prototype pollution or code execution; text remains inert.

### BACK-024 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Two projects with same visible title
- **When:** Restore
- **Then:** Distinct IDs retained; no title-based deduplication.

### BACK-025 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: specified

- **Given:** Local logo embedded in backup, offline restore
- **When:** Print
- **Then:** Logo resolves from restored local bytes; no remote file dependency.

### BACK-026 · P0 · integration

Source: `tool-specs/10; DATA_CONTRACT.md` · Contract: decision_required

- **Given:** Import unknown future engine version with schema2
- **When:** Validate/display
- **Then:** Compatibility check per documented policy; never silently recalc unsupported issued data. Resolve display-compatibility policy before implementation.

## Browser, accessibility and privacy

### UX-001 · P1 · browser

Source: `ACCEPTANCE_TESTS.md P01–P07` · Contract: specified

- **Given:** 360px mobile viewport
- **When:** Complete each free tool and Pro estimate
- **Then:** No hidden required controls,horizontal page overflow,or unreadable totals.

### UX-002 · P1 · browser

Source: `ACCEPTANCE_TESTS.md P01–P07` · Contract: specified

- **Given:** Keyboard-only user
- **When:** Navigate inputs,add/remove rows,open errors,print
- **Then:** Visible focus,logical order,operable controls,no trap.

### UX-003 · P1 · browser

Source: `ACCEPTANCE_TESTS.md P01–P07` · Contract: specified

- **Given:** Invalid submission
- **When:** Inspect error announcement and focus
- **Then:** Field-linked message identifies correction; stale final output not announced as valid.

### UX-004 · P1 · browser

Source: `ACCEPTANCE_TESTS.md P01–P07` · Contract: proposed_hardening

- **Given:** Screen reader reads monetary results
- **When:** Change inputs
- **Then:** Proposed UX gate: result updates announced without reading every keystroke or stripping minus sign/units.

### UX-005 · P1 · browser

Source: `ACCEPTANCE_TESTS.md P01–P07` · Contract: specified

- **Given:** Reduce-motion preference enabled
- **When:** Navigate tools
- **Then:** Essential states remain visible; nonessential motion disabled/reduced.

### UX-006 · P1 · browser

Source: `ACCEPTANCE_TESTS.md P01–P07` · Contract: specified

- **Given:** Optional analytics active
- **When:** Calculate with customer name/address/notes
- **Then:** No personal fields,full estimate content or license values sent in analytics.

### UX-007 · P1 · browser

Source: `ACCEPTANCE_TESTS.md P01–P07` · Contract: specified

- **Given:** Slow render/repeated calculate clicks
- **When:** Submit same values
- **Then:** No duplicate project/expense creation or stale result replacing latest input.

### UX-008 · P1 · browser

Source: `ACCEPTANCE_TESTS.md P01–P07` · Contract: specified

- **Given:** Rapid type-invalid-then-valid sequence
- **When:** Await updates
- **Then:** Latest valid inputs determine result; prior async work cannot overwrite them.

### UX-009 · P1 · browser

Source: `ACCEPTANCE_TESTS.md P01–P07` · Contract: specified

- **Given:** Print from narrow browser viewport
- **When:** Save PDF
- **Then:** Print layout remains readable independent of mobile screen width.

### UX-010 · P1 · browser

Source: `ACCEPTANCE_TESTS.md P01–P07` · Contract: specified

- **Given:** Local storage unavailable/private mode failure
- **When:** Save
- **Then:** Actionable warning; no false persistence claim; export guidance.

### UX-011 · P1 · browser

Source: `ACCEPTANCE_TESTS.md P01–P07` · Contract: specified

- **Given:** Browser data cleared
- **When:** Reopen app then restore backup
- **Then:** Explain data loss/recovery; backup restores data; purchase recovery separate.

### UX-012 · P1 · browser

Source: `ACCEPTANCE_TESTS.md P01–P07` · Contract: specified

- **Given:** Production homepage samples
- **When:** Inspect captions/live tool link
- **Then:** Illustration labeled; no claim live defaults reproduce marketing sample.

### UX-013 · P1 · browser

Source: `ACCEPTANCE_TESTS.md P01–P07` · Contract: specified

- **Given:** Free result completed
- **When:** Follow Pro invitation
- **Then:** Useful answer remains accessible; compatible input handoff retains values/units; purchase not silently granted.

## Purchase and entitlement integration

### ACCESS-001 · P0 · integration/browser

Source: `ACCESS_SPEC.md` · Contract: specified

- **Given:** Unauthenticated/no-entitlement user visits success URL directly
- **When:** Open Pro
- **Then:** No paid unlock based on URL/query alone.

### ACCESS-002 · P0 · integration/browser

Source: `ACCESS_SPEC.md` · Contract: specified

- **Given:** Paid flag manually written in localStorage
- **When:** Open protected feature
- **Then:** Not accepted as verified entitlement.

### ACCESS-003 · P0 · integration/browser

Source: `ACCESS_SPEC.md` · Contract: specified

- **Given:** Verified successful provider event
- **When:** Process once
- **Then:** Entitlement delivered exactly once and associated with correct purchaser/product.

### ACCESS-004 · P0 · integration/browser

Source: `ACCESS_SPEC.md` · Contract: specified

- **Given:** Duplicate valid provider event
- **When:** Process repeatedly
- **Then:** Idempotent delivery; no duplicate licenses/charges from fulfillment handler.

### ACCESS-005 · P0 · integration/browser

Source: `ACCESS_SPEC.md` · Contract: specified

- **Given:** Forged signature or wrong product/amount event
- **When:** Verify
- **Then:** Reject; no access granted; trusted provider verification required.

### ACCESS-006 · P0 · integration/browser

Source: `ACCESS_SPEC.md` · Contract: specified

- **Given:** Cancelled or failed checkout
- **When:** Return to site
- **Then:** No entitlement; helpful retry path.

### ACCESS-007 · P0 · integration/browser

Source: `ACCESS_SPEC.md` · Contract: specified

- **Given:** Provider event delayed after return
- **When:** Check access
- **Then:** Pending state; no false failure or unverified success.

### ACCESS-008 · P0 · integration/browser

Source: `ACCESS_SPEC.md` · Contract: specified

- **Given:** Purchaser returns on allowed new device
- **When:** Recover via selected policy
- **Then:** Verified recovery without project backup acting as purchase proof.

### ACCESS-009 · P0 · integration/browser

Source: `ACCESS_SPEC.md` · Contract: decision_required

- **Given:** Network fails during verification
- **When:** Open paid app
- **Then:** Behavior follows documented offline/grace policy; unresolved until provider/access design chosen.

### ACCESS-010 · P0 · integration/browser

Source: `ACCESS_SPEC.md` · Contract: decision_required

- **Given:** Refund/revocation event
- **When:** Apply access policy
- **Then:** Behavior follows documented refund policy; no invented automatic deletion of user's project data.

### ACCESS-011 · P0 · integration/browser

Source: `ACCESS_SPEC.md` · Contract: specified

- **Given:** Export backup then inspect
- **When:** Search for purchase secrets
- **Then:** No signing keys,payment secrets or bearer license tokens.

### ACCESS-012 · P0 · integration/browser

Source: `ACCESS_SPEC.md` · Contract: specified

- **Given:** Production bundle/source map
- **When:** Inspect secrets
- **Then:** No private signing or payment secret keys shipped to browser.

## Fixed arithmetic regression

### NUM-job-original-brief · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"expenses": "175", "labor": "1344", "materials": "1104", "overheadRatio": "0.15", "price": "4640.70", "targetRatio": "0.35"}
- **When:** Run equivalent production calculation for kind job
- **Then:** {"approxPrice": "4640.69", "cost": "3016.45", "directCost": "2623.00", "marginPercent": "35.0", "minimumPrice": "4640.70", "overhead": "393.45", "profit": "1624.25"}

### NUM-job-homepage · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"expenses": "0", "labor": "1280", "materials": "620", "overheadRatio": "0.15", "price": "3200", "targetRatio": "0.35"}
- **When:** Run equivalent production calculation for kind job
- **Then:** {"approxPrice": "3361.54", "cost": "2185.00", "directCost": "1900.00", "marginPercent": "31.7", "minimumPrice": "3361.54", "overhead": "285.00", "profit": "1015.00"}

### NUM-door-homepage · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"cost": "67", "price": "85", "targetRatio": "0.35"}
- **When:** Run equivalent production calculation for kind price
- **Then:** {"approxPrice": "103.08", "marginPercent": "21.2", "minimumPrice": "103.08", "profit": "18.00", "status": "below_target"}

### NUM-loss · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"cost": "100", "price": "85", "targetRatio": "0.35"}
- **When:** Run equivalent production calculation for kind price
- **Then:** {"approxPrice": "153.85", "marginPercent": "-17.6", "minimumPrice": "153.85", "profit": "-15.00", "status": "below_cost"}

### NUM-at-target · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"cost": "65", "price": "100", "targetRatio": "0.35"}
- **When:** Run equivalent production calculation for kind price
- **Then:** {"approxPrice": "100.00", "marginPercent": "35.0", "minimumPrice": "100.00", "profit": "35.00", "status": "at_target"}

### NUM-unpriced · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"cost": "100", "price": null, "targetRatio": "0.35"}
- **When:** Run equivalent production calculation for kind price
- **Then:** {"approxPrice": "153.85", "marginPercent": null, "minimumPrice": "153.85", "profit": null, "status": "unpriced"}

### NUM-no-charge · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"cost": "100", "price": "0", "targetRatio": "0.35"}
- **When:** Run equivalent production calculation for kind price
- **Then:** {"approxPrice": "153.85", "marginPercent": null, "minimumPrice": "153.85", "profit": "-100.00", "status": "zero_price"}

### NUM-rounding-target-boundary · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"cost": "1", "price": "1.66", "targetRatio": "0.40"}
- **When:** Run equivalent production calculation for kind price
- **Then:** {"approxPrice": "1.67", "marginPercent": "39.8", "minimumPrice": "1.67", "profit": "0.66", "status": "below_target"}

### NUM-interior-walls-brief · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"ceilingRate": "120", "coats": 2, "coverage": "350", "doorArea": "20", "doorCount": 2, "height": "9", "includeCeiling": false, "laborRate": "32", "length": "20", "paintPrice": "42", "wallRate": "150", "wasteRatio": "0.1", "width": "16", "windowArea": "15", "windowCount": 3}
- **When:** Run equivalent production calculation for kind interior
- **Then:** {"coatArea": "1126.00", "deduction": "85.00", "grossArea": "648.00", "hours": "7.506667", "laborCost": "240.21", "netWall": "563.00", "paintCost": "168.00", "purchaseGallons": 4, "rawGallons": "3.538857", "totalArea": "563.00", "totalCost": "408.21"}

### NUM-interior-with-ceiling · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"ceilingRate": "120", "coats": 2, "coverage": "350", "doorArea": "20", "doorCount": 2, "height": "9", "includeCeiling": true, "laborRate": "32", "length": "20", "paintPrice": "42", "wallRate": "150", "wasteRatio": "0.1", "width": "16", "windowArea": "15", "windowCount": 3}
- **When:** Run equivalent production calculation for kind interior
- **Then:** {"coatArea": "1766.00", "deduction": "85.00", "grossArea": "648.00", "hours": "12.840000", "laborCost": "410.88", "netWall": "563.00", "paintCost": "252.00", "purchaseGallons": 6, "rawGallons": "5.550286", "totalArea": "883.00", "totalCost": "662.88"}

### NUM-document-rounding · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"lines": [["1", "12.005"], ["1", "12.005"]], "taxRatio": "0.10"}
- **When:** Run equivalent production calculation for kind document
- **Then:** {"lines": ["12.01", "12.01"], "subtotal": "24.02", "tax": "2.40", "total": "26.42"}

### NUM-pool-same-product · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"demands": [["A", "1.2"], ["A", "1.2"]], "prices": {"A": "42"}}
- **When:** Run equivalent production calculation for kind paint
- **Then:** {"paintCost": "126.00", "purchases": {"A": 3}}

### NUM-separate-colors · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"demands": [["white", "1.2"], ["blue", "1.2"]], "prices": {"blue": "42", "white": "42"}}
- **When:** Run equivalent production calculation for kind paint
- **Then:** {"paintCost": "168.00", "purchases": {"blue": 2, "white": 2}}

### NUM-exact-purchase-boundaries · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"demands": [["exact", "3"], ["under", "2.9999999999"], ["over", "3.0000000001"]], "prices": {"exact": "1", "over": "1", "under": "1"}}
- **When:** Run equivalent production calculation for kind paint
- **Then:** {"paintCost": "10.00", "purchases": {"exact": 3, "over": 4, "under": 3}}

### NUM-wall-service · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"additionalHours": "0", "applicationHours": "1/75", "areaPerUnit": "1", "coats": 2, "coverage": "350", "expenses": "0", "laborRate": "32", "overheadRatio": "0.15", "paintPrice": "42", "price": "1.80", "supplies": "0", "targetRatio": "0.35", "wasteRatio": "0.1"}
- **When:** Run equivalent production calculation for kind service
- **Then:** {"approxPrice": "1.22", "costPerUnit": "0.794267", "laborPerUnit": "0.426667", "marginPercent": "55.9", "minimumPrice": "1.23", "paintPerUnit": "0.264000"}

### NUM-trim-surface · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"coats": 2, "coverage": "350", "developedWidth": "0.5", "laborRate": "32", "length": "100", "paintPrice": "42", "surfaceKind": "trim", "throughput": "40", "wasteRatio": "0.1"}
- **When:** Run equivalent production calculation for kind surface
- **Then:** {"area": "50.00", "hours": "5.000000", "laborCost": "160.00", "paintCost": "42.00", "purchasedGallons": 1, "rawGallons": "0.314286"}

### NUM-door-two-faces · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"coats": 2, "count": 1, "coverage": "350", "height": "7", "hoursPerSidePerCoat": "0.75", "laborRate": "32", "paintPrice": "42", "sides": 2, "surfaceKind": "door", "wasteRatio": "0.1", "width": "3"}
- **When:** Run equivalent production calculation for kind surface
- **Then:** {"area": "42.00", "hours": "3.000000", "laborCost": "96.00", "paintCost": "42.00", "purchasedGallons": 1, "rawGallons": "0.264000"}

### NUM-actual-final · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"baselineCost": "2185", "baselinePrice": "3200", "expenses": "100", "labor": "1400", "materials": "700", "overhead": "285"}
- **When:** Run equivalent production calculation for kind actual
- **Then:** {"actualCost": "2485.00", "marginPercent": "22.3", "profit": "715.00", "totalVariance": "300.00"}

### NUM-actual-final-loss · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"baselineCost": "2185", "baselinePrice": "3200", "expenses": "200", "labor": "2000", "materials": "1000", "overhead": "300"}
- **When:** Run equivalent production calculation for kind actual
- **Then:** {"actualCost": "3500.00", "marginPercent": "-9.4", "profit": "-300.00", "totalVariance": "1315.00"}

### NUM-actual-zero-price · P0 · unit

Source: `acceptance-fixtures.json` · Contract: specified

- **Given:** {"baselineCost": "100", "baselinePrice": "0", "expenses": "0", "labor": "0", "materials": "100", "overhead": "0"}
- **When:** Run equivalent production calculation for kind actual
- **Then:** {"actualCost": "100.00", "marginPercent": null, "profit": "-100.00", "totalVariance": "0.00"}

## Boundary matrix

### BOUND-001 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active coats field with value 1
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-002 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active coats field with value 5
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-003 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active coats field with value 0
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-004 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active coats field with value 6
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-005 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid coats=1.5
- **When:** Validate integer requirement
- **Then:** Reject fractional count/coats; do not truncate.

### BOUND-006 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active targetMarginRatio field with value 0
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-007 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active targetMarginRatio field with value 0.999
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-008 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active targetMarginRatio field with value -0.001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-009 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active targetMarginRatio field with value 1
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-010 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active overheadRatio field with value 0
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-011 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active overheadRatio field with value 1
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-012 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active overheadRatio field with value -0.001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-013 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active overheadRatio field with value 1.001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-014 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active wasteRatio field with value 0
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-015 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active wasteRatio field with value 1
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-016 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active wasteRatio field with value -0.001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-017 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active wasteRatio field with value 1.001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-018 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active roomDimensionFt field with value 0.001
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-019 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active roomDimensionFt field with value 100000
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-020 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active roomDimensionFt field with value 0
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-021 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active roomDimensionFt field with value 100000.001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-022 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active manualAreaFt2 field with value 0.001
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-023 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active manualAreaFt2 field with value 1000000000
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-024 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active manualAreaFt2 field with value 0
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-025 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active manualAreaFt2 field with value 1000000000.001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-026 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active trimLengthFt field with value 0
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-027 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active trimLengthFt field with value 1000000
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-028 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active trimLengthFt field with value -0.001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-029 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active trimLengthFt field with value 1000000.001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-030 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active doorCount field with value 0
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-031 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active doorCount field with value 100000
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-032 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active doorCount field with value -1
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-033 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active doorCount field with value 100001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-034 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid doorCount=1.5
- **When:** Validate integer requirement
- **Then:** Reject fractional count/coats; do not truncate.

### BOUND-035 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active hours field with value 0
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-036 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active hours field with value 1000000
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-037 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active hours field with value -0.001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-038 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active hours field with value 1000000.001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-039 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active moneyAmount field with value 0
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-040 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active moneyAmount field with value 1000000000
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-041 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active moneyAmount field with value -0.01
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-042 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active moneyAmount field with value 1000000000.01
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-043 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active throughput field with value 0.001
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-044 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active throughput field with value 1000000
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-045 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active throughput field with value 0
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-046 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active throughput field with value 1000000.001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-047 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active roomCount field with value 0
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-048 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active roomCount field with value 500
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-049 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active roomCount field with value -1
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-050 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active roomCount field with value 501
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-051 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid roomCount=1.5
- **When:** Validate integer requirement
- **Then:** Reject fractional count/coats; do not truncate.

### BOUND-052 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active surfaceCount field with value 0
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-053 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active surfaceCount field with value 2000
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-054 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active surfaceCount field with value -1
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-055 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active surfaceCount field with value 2001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-056 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid surfaceCount=1.5
- **When:** Validate integer requirement
- **Then:** Reject fractional count/coats; do not truncate.

### BOUND-057 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active documentLineCount field with value 0
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-058 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active documentLineCount field with value 2000
- **When:** Validate field separately from complete project
- **Then:** accepted at field validation; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-059 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active documentLineCount field with value -1
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-060 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid active documentLineCount field with value 2001
- **When:** Validate field separately from complete project
- **Then:** rejected as out of range; zero-count project can still fail issue gate; unusual-value warnings still apply.

### BOUND-061 · P0 · unit

Source: `CALCULATION_SPEC.md §1` · Contract: specified

- **Given:** Otherwise valid documentLineCount=1.5
- **When:** Validate integer requirement
- **Then:** Reject fractional count/coats; do not truncate.
