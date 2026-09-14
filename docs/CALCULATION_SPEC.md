# Authoritative calculation contract — v2.1

## 1. Numeric representation, parsing, and result states
Persist calculation scalars as canonical decimal strings (e.g. "32", "0.15", "563.5"); counts are nonnegative integers. Use a decimal-arithmetic implementation, precision at least 40 significant digits, rather than binary floats for totals and purchasing. JSON never stores NaN, Infinity, or an undefined property in place of a required value.
UI money/quantity fields accept plain decimal text; reject malformed text, non-finite numbers, negative costs, mixed units, and partial numeric strings such as "12abc". A displayed percent of 35 becomes targetMarginRatio="0.35" exactly once at the UI boundary. No downstream divide-by-100 on Ratio fields.

Inputs have distinct states: missing (null), invalid (an error), and valid including explicit zero. Optional omitted expenses default to zero at model creation; actuals do not. Retain invalid raw text in the UI for correction; do not commit it as a valid numeric value.

CalculationResult<T> = {state: "complete" | "incomplete" | "invalid", value: T | null, errors: [{path, code, message}], warnings: [{path, code, message}]}.
An incomplete/invalid project may display a labeled partial subtotal of valid components, but cannot display a final margin/status, be issued, or be printed as a priced estimate. Draft saving is allowed. A scope-only draft may be printed clearly labeled DRAFT / PRICE PENDING.

Ranges: counts integer >=0; coats integer 1..5 for enabled surfaces; geometry >0 where required; quantities/price/cost >=0; production throughput and coverage >0; time per unit >0; targetMarginRatio 0 <= m < 1; overheadRatio 0..1; wasteRatio 0..1. Waste >0.5 and overhead >0.5 produce nonblocking review warnings. Surface dimensions may be positive without paint enabled. Disable a surface explicitly rather than assigning zero coats.
Engineering bounds: at most 500 rooms, 2,000 surfaces, 2,000 document lines per project; dimensions <=100,000 ft, area <=1,000,000,000 ft², trim <=1,000,000 ft, door count <=100,000, hours <=1,000,000, monetary inputs <=1,000,000,000 USD, rates <=1,000,000 per unit and >0 where divisors. Amounts above $1,000,000 warn. Out-of-bound inputs error. Near-100% targets are valid, but required prices above $1 billion return out_of_supported_range with no issueable price, never Infinity. These are software limits, not industry guidance.

## 2. Units and defaults
Dimensions ft; area ft²; trim linear ft; paint US gal; costs USD; throughput ft²/hour/coat or linear ft/hour/coat; door time hours/door-side/coat.
Default room height 8 ft, coats 2, coverage 350 ft²/gal, wasteRatio 0.10, overheadRatio 0.15, targetMarginRatio 0.35. All editable. Suggested throughput seeds: wall 150 ft²/hr/coat, ceiling 120, trim 40 linear ft/hr/coat. Door time seed 0.75 hr/side/coat. These are explicitly unvalidated sample assumptions, requiring user confirmation before first priced issue.
No default paid labor or paint price: user supplies or explicitly accepts a labeled sample. Free interior may initialize a labeled editable $45/gal example. Free job-cost inputs start missing/zero as detailed in its document.
Quick openings use exact area constants: door 20 ft², window 15 ft², matching the original brief. Detailed measured dimensions supersede constants: 3 × 6.67 ft = 20.01 ft², not 20. Quick mode never pretends to have measured widths/heights.
Trim developed paintable width, door dimensions, and painted sides have no hidden defaults; require explicit values on enabled surfaces. Door painted sides allowed 1 or 2. Door edges excluded unless represented as an additional measured surface.

## 3. Geometry
rectangular wall gross = 2*(length+width)*height.
ceiling = length*width.
quick opening area = doorCount*doorAreaEach + windowCount*windowAreaEach.
detailed opening area = sum(width*height*count).
Deduction enabled: net wall = gross-opening area. If opening area > gross, return invalid; a display-only preview can clamp to zero but final calculation remains blocked. Deduction disabled: net wall=gross; ignore inactive opening entries.
Room wall, ceiling, trim, and door painting are independently enabled. Opening counts never automatically become doors-to-paint.
Manual-area wall/ceiling surfaces bypass rectangular geometry and take measured net area explicitly.
Trim: paintable area = trimLengthFt * developedPaintableWidthFt. Developed width is total painted face width per length unit, not merely one nominal face if multiple faces are painted. V1 uses direct trim length; no automatic window/door casing formula.
Door: paintable area = count*widthFt*heightFt*paintedSides. A side is one face. Doors of different dimensions/sides are separate surfaces. Labor uses the same side count, below.

## 4. Paint and project aggregation
Each enabled surface selects one immutable paint variant (specific product, color, sheen) from its active snapshot, coats, and wasteRatio.
rawDemandGal(surface) = paintableAreaFt2 * coats * (1+wasteRatio) / coverageFt2PerGal.
Group compatible raw demand by paintVariantId within the active snapshot; variants differing by color or sheen never pool. Sum raw demand across all rooms/surfaces FIRST.
purchasedGallons(variant) = ceiling(sum rawDemandGal for variant).
paintCost(variant) = purchasedGallons * pricePerGal.
Store/display rawDemand and purchasedGallons separately. Zero demand buys zero gallons. No room-by-room ceiling.
No epsilon: exact decimal boundaries apply. Exactly 3 →3; 2.9999999999 →3; 3.0000000001 →4. The decimal engine and rational checks for known boundary fixtures must avoid manufacturing binary noise. Where necessary implement ceiling of the exact decimal numerator/denominator rather than a rounded intermediate quotient.

## 5. Labor, supplies, and expenses
wall/ceiling productionHours = netArea*coats/throughput.
trim productionHours = trimLength*coats/throughputLinearFt.
door productionHours = count*paintedSides*coats*hoursPerDoorSidePerCoat.
Production is application-only; prep, masking, cleanup, setup, and touch-up may be added as named additionalLabor lines {hours, loadedHourlyRate}. Explain this basis to avoid omissions/double-counting.
laborCost = sum(surfaceProductionHours*surfaceLoadedHourlyRate) + sum(additionalLabor hours*rate).
loadedHourlyRate includes labor burden chosen by user; do not also apply that same burden as a separate expense.
otherMaterialCost = sum(quantity*unitCost) for selected project supplies.
supplies allowance mode = none | flat | paintPercent. flat is a nonnegative dollar amount; paintPercent is allowanceRatio 0..1 times paintCost. Only active mode contributes. Show allowance separate from itemized supplies; user confirms they do not duplicate costs.
materials = paintCost + otherMaterialCost + suppliesAllowance.
otherExpenses = sum named direct expenses, including travel if entered. Business default travel creates ONE project expense line for a new draft; it is not silently reapplied on recalc/duplication.
directCost = materials+laborCost+otherExpenses.
Pro overhead = directCost*overheadRatio (single v1 allocation method).
Free job-cost tool also allows explicit flat overhead; this is a tool-specific exception.
estimatedJobCost = directCost+overhead.
No automatic geographical rates, tax rates, or recommended market prices.

## 6. Price, profit, and margin
requiredPriceRaw = cost/(1-targetMarginRatio), valid cost>=0 and 0<=ratio<1.
No price (null): profit=null, margin=null, status=unpriced.
Explicit price=0: profit=-cost, margin=null, status=zero_price; warn and require explicit confirmation to issue a no-charge estimate.
Positive price: profit=price-cost; marginRatio=profit/price. Negative profit/margin remain negative. Markup, if ever displayed, is profit/cost with distinct label; not a margin input.
status for valid positive price: below_cost if profit<0; otherwise below_target if margin<target; at_target if exactly equal; above_target if greater. Display labels: Below estimated cost, Review pricing, At target, Above target. Compare raw decimals, not one-decimal display percentages.
requiredPriceNearestCent = HALF_UP(requiredPriceRaw,2), labeled approximate.
minimumTargetPrice = CEILING(requiredPriceRaw*100)/100, labeled minimum cent price meeting target. Prefill suggestedProposedPrice with minimumTargetPrice, never nearest-cent approximation, so a rounded suggestion cannot fall just short of target. Recompute actual margin from that cent price.
User-entered proposedPrice uses at most two decimal places; reject extra decimals until corrected. Price mode suggested follows recalculation; mode custom retains the price and only updates costs/margin. Explicitly selecting 'use target price' returns to suggested mode. An all-empty project has no final suggestion.
Taxes: Pro v1 proposedPrice is a pre-tax selling price. Customer output explicitly says taxes are not calculated/included. No paid tax automation or hidden addition. If that is insufficient for a buyer's workflow, add a separately specified manual tax extension before claiming tax-inclusive quotations.

## 7. Rounding boundaries and presentation
Use HALF_UP monetary display to cents, percentages to one decimal, quantities at useful precision. Do not reuse formatted outputs in calculation. Hours show two decimals with 'approx.' if needed; expanding reveals additional precision; cost uses raw hours. Do not display quarter-hour-rounded hours as exact billed hours.
Cost breakdown: sum raw components, then round grand total. If displayed category cents do not sum to displayed total, show an explicit rounding-adjustment row (difference in cents). This reconciles display without changing internal costs.
Customer Pro document has one exact two-decimal selling total, not internal cost subtotals.
Free manual document is a separate monetary-ledger boundary: round EACH line extension HALF_UP to cents, sum line cents, round tax on that subtotal HALF_UP to cents, add. This is intentionally different from internal high-precision cost estimation.

## 8. Service-unit cost model (Price Book Health)
Each service explicitly specifies unit, paint variant, coats, wasteRatio, labor mode/rate, materialAreaFt2PerUnit, suppliesCostPerUnit, and directExpensePerUnit. Missing assumptions yield incomplete, not zero-cost.
Area per unit: wall/ceiling=1 ft²; trim=developed width ft (1 linear ft basis); door=width*height*paintedSides (1 door basis).
applicationHoursPerUnit: wall/ceiling=coats/throughput; trim=coats/linearThroughput; door=paintedSides*coats*hoursPerSidePerCoat.
laborHoursPerUnit=applicationHoursPerUnit+additionalLaborHoursPerUnit.
paintConsumptionCostPerUnit=areaPerUnit*coats*(1+wasteRatio)/coverage*pricePerGal. NO whole-gallon rounding for service units.
materialsPerUnit=paintConsumptionCostPerUnit+suppliesCostPerUnit.
directCostPerUnit=materialsPerUnit+laborHoursPerUnit*loadedRate+directExpensePerUnit.
overheadPerUnit=directCostPerUnit*overheadRatio.
modeledCostPerUnit=directCostPerUnit+overheadPerUnit.
Use section 6 for profit, margin, status, and requiredPrice/minimumTargetPrice. Current service price is selling dollars per service unit, at most two decimals, or null.
Supplies and direct expenses per unit are explicit manual allocations; never automatically copy a project travel charge onto every door. Display: 'Consumption-based service model. Job totals may differ due to purchased pack sizes, setup time, and project expenses.'
Price Book Health reads CURRENT service/catalog values. It never modifies saved estimate snapshots.
Homepage $1.04/$1.08/$0.79/$67 costs remain labeled illustrative unless generated from complete fixtures. Reverse-solving costs from margins is not validation of a shared production model.

## Final marketing/example policy
The homepage's existing Price Book Health figures remain purely illustrative examples. Keep the visible label **Illustrative preview** and add or retain adjacent clarification: **Sample figures only. Your results depend on your entered costs, rates, and job assumptions.** Do not describe the table as the output of default settings or as a tested screenshot of the working engine. Do not tune labor, material, or production defaults to reproduce 42.2%, 28.0%, 36.8%, or 21.2%.
The forward-derived wall-service fixture remains authoritative for its stated inputs: modeled cost about $0.794267/ft² and displayed margin 55.9% at $1.80/ft². Production assumptions are editable sample seeds, not validated industry rates. When replacing the marketing illustration with a real product screenshot, generate it from a saved, complete example dataset and use its actual outputs. This policy is finalized; no default-selection decision remains pending to match the illustration.
