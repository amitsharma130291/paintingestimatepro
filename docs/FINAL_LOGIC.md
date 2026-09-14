# Painting Estimate Pro — Final Logic Document

Version 2.1 · Final reviewed specification · 2026-09-14

This consolidated document supersedes the earlier v2.0 logic. Source-file references identify the corresponding files in the accompanying ZIP. No production implementation is included.

## Contents

1. README.md
2. CALCULATION_SPEC.md
3. DATA_CONTRACT.md
4. tool-specs/00-shared-core.md
5. tool-specs/01-free-estimate-template.md
6. tool-specs/02-free-job-cost-calculator.md
7. tool-specs/03-free-interior-calculator.md
8. tool-specs/04-pro-business-settings-catalog.md
9. tool-specs/05-pro-room-surface-entry.md
10. tool-specs/06-pro-estimate-summary.md
11. tool-specs/07-pro-price-book-health.md
12. tool-specs/08-pro-estimate-output.md
13. tool-specs/09-pro-actual-cost-review.md
14. tool-specs/10-pro-backup-restore.md
15. ACCEPTANCE_TESTS.md
16. ACCESS_SPEC.md
17. IMPLEMENTATION_PROMPT.md
18. CHANGELOG.md


---

Source: `README.md`

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


---

Source: `CALCULATION_SPEC.md`

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


---

Source: `DATA_CONTRACT.md`

# Authoritative data and lifecycle contract — schemaVersion 2

Canonical decimal strings and ratios follow CALCULATION_SPEC.md. IDs are stable UUID-like strings, never array positions. All records include createdAt/updatedAt ISO timestamps. Input validators reject unknown enums and unsafe types; text is rendered as text, never interpreted as HTML. Keep original imported data unmodified until validation succeeds.

## Entities (required unless explicitly optional)
BusinessSettings: id, loadedHourlyRate (nullable until configured), overheadRatio, targetMarginRatio, defaultCoats, defaultWasteRatio, wallThroughput, ceilingThroughput, trimThroughput, doorHoursPerSidePerCoat, defaultTravelAmount, defaultSuppliesAllowance {mode:none|flat|paintPercent, amount, ratio}, sampleAssumptionsConfirmed boolean.
Defaults seed geometry/rates per calculation contract; defaultTravelAmount=0 and supplies mode=none. An explicit sample dataset is separate from a real project.
PaintVariant: id, name, color, sheen, pricePerGal, coverageFt2PerGal, purchaseIncrementGal="1". Color/sheen can be 'unspecified' only if explicitly chosen; variant identity determines pooling. At most one value set per ID in a snapshot. Renaming a live variant never changes old snapshots.
OtherMaterial: id, name, unit, unitCost.
ServiceDefinition: id, name, unit (ft2|linearFt|door), kind (wall|ceiling|trim|door), paintVariantId, coats, wasteRatio, loadedHourlyRate, throughput (wall/ceiling/trim only), hoursPerSidePerCoat (door only), developedWidthFt (trim only), widthFt/heightFt/paintedSides (door only), additionalLaborHoursPerUnit, suppliesCostPerUnit, directExpensePerUnit, currentSellingPrice nullable. Labor and overhead defaults are copied to editable service assumptions; expose an explicit refresh-defaults action. Global current overhead/target apply to health; material price/coverage resolve live.
Room: id, name, lengthFt/widthFt/heightFt (nullable draft), deductionEnabled, openingMode quick|detailed, quick {doorCount,windowCount,doorAreaEach,windowAreaEach}, openings [{id,type,widthFt,heightFt,count}], surfaceIds[]. Inactive opening mode ignored.
Surface: id, roomId nullable, kind, enabled, measurementMode roomDerived|manual, areaFt2 (manual wall/ceiling), trimLengthFt/developedWidthFt (trim), doorCount/widthFt/heightFt/paintedSides (door), paintVariantId, coats, wasteRatio, loadedHourlyRate, throughput or hoursPerSidePerCoat. Required fields depend on enabled/kind/mode. Room-derived only for wall/ceiling; trim/door measurements explicit. Standalone surfaces have roomId=null.
RateSnapshot: id, capturedAt, sourceSettingsId, sourceCatalogRevision, engineVersion, full copies of business settings, material variants and selected other-material prices, plus any service assumptions actually used. Snapshot is self-contained. Surface-specific overrides are inside the revision, not pointers to live defaults.
EstimateRevision: id, projectId, revisionNumber, state draft|issued|superseded, title, businessInfo, customerInfo, room/surface arrays, activeRateSnapshot, additionalLabor[], otherMaterialLines[], suppliesAllowance, otherExpenses[], priceMode suggested|custom, proposedPrice nullable, notes, terms, calculationState, engineVersion, rawCalculatedOutputs (optional until valid), customerDocumentSnapshot (on issue), issuedAt nullable.
additionalLabor line: id, description, hours, loadedHourlyRate.
otherMaterial line: id, description, sourceMaterialId nullable, unit, quantity, unitCost snapshot.
expense line: id, description, amount. Travel is one explicit line.
Project: id, title, revisions[], activeRevisionId, actualReviews[].
Document metadata: estimateNumber string, estimateDate, projectAddress optional, businessInfo {name,contact,address,logo optional}, customerInfo {name,address,contact}, scope/notes/terms. Strings may be blank in draft. Priced issue needs a project title and at least one enabled valid surface, and confirmed assumptions; buyer/customer omission warns but does not silently insert fiction.

## Drafts, issue, and revisions
1. New draft copies current settings/catalog to its activeRateSnapshot. Draft autosave persists its OWN snapshot and changes; it does not recopy the live catalog.
2. Reopen a draft or issued revision using its embedded snapshot, even if a catalog variant was deleted.
3. Explicit 'refresh with current rates' on draft previews changed rates and resulting price/margin. Unresolved deleted variants require a replacement or retaining the snapshot variant; never replace by name. Confirm before applying. Keep a recoverable pre-refresh draft snapshot.
4. Issue validates complete inputs, resolves price, confirms sample assumptions and zero-price if applicable, then freezes inputs, rates, outputs, and customer document. Store engineVersion. Subsequent view/print uses the issued snapshot, not today's engine results.
5. Editing, deleting a room, changing price, or refreshing rates on an issued estimate creates a new draft revision. Preserve the original. Only explicit issue supersedes the previous issued revision. Actual reviews stay linked to the chosen issued revision.
6. A duplicate project gets fresh project/revision/room/surface/line IDs and remapped references; it copies rates by default, drops issued state, documents/actuals, and clears estimate number. It never shares mutable arrays with its source.
7. Engine upgrades may migrate schemas but must not recalculate historical issued output automatically. New recalculation creates a draft revision with a new engineVersion.

## Actual review
ActualReview: id, projectId, baselineIssuedRevisionId, state inProgress|final, materials/labor/otherExpenses categories each {confirmed:boolean, amount:decimal|null}; optional laborBreakdown {mode:direct|hoursRate,hours,rate}; overhead {mode:baselineAllocation|actualFlat, confirmed:boolean, amount:decimal|null}; updatedAt.
Use one authoritative active labor mode; no stale values contribute. baselineAllocation amount is the baseline issued overhead, explicitly labeled and confirmed. Finalization requires all four categories confirmed and nonnull (explicit zero allowed).
Final revenue basis is original issued pre-tax proposedPrice, NOT payment receipts. Compute margin = (baselinePrice - actualCost) / baselinePrice whenever baselinePrice > 0, including losses; baselinePrice = 0 yields margin null and retains the loss amount. Missing baseline price is invalid for an issued baseline. Label 'profit against original quoted price'; change orders/actual revenue collection are out of v1. Partial review shows recorded costs and category completeness only; no final profit, margin, or total variance.

## Backup envelope
{schemaVersion:2, exportId, exportedAt, installationId, engineVersion, businessSettings, paintVariants:[], otherMaterials:[], serviceDefinitions:[], projects:[], importProvenance:[]}.
Each project includes all revisions, snapshots, issued document data, actual reviews, stable IDs, and links. Include normalized local logo bytes if supported; no remote/private file dependency. Exclude payment secrets, license tokens, analytics identifiers. Access recovery is separate.
Use transactional local persistence (e.g. IndexedDB) for multi-record operations. On quota/storage error, leave previous committed state intact and show an actionable save/backup message. Never claim 'saved' on failure.
Import file limit 25 MiB, logo max 1 MiB each; limits may be raised explicitly after testing. Validate all schemas, required fields, decimal ranges, object counts, duplicate IDs, snapshots, referenced IDs, and supported schema/engine display compatibility before writes. Version 1 backups unsupported until an explicit tested migrator exists; newer versions rejected. No silent migration guesses.

Import modes:
- Restore/merge (default): preserve IDs; identical existing records skip; new IDs add. Conflicting content at same ID requires explicit keep-local, replace-imported, or keep-both per project/settings group. Default keep-local. Preserve original snapshot references. No automatic timestamp-wins rule.
- Import as copies: new IDs throughout each imported graph, remap all links including baseline revision. Keep importProvenance keyed by exportId + sourceProjectId. On repeat same import show 'already imported' and skip unless user explicitly asks for another copy; no automatic upsert into locally edited copies.
- Replace all: explicit confirmation, downloadable pre-import backup, atomic replacement after full validation.
A failed import never partly changes the store. Settings/catalog collisions are resolved alongside projects, not matched by name+price. Identical names with different coverage/color remain distinct variants.


---

Source: `tool-specs/00-shared-core.md`

# Shared core — v2.1
The complete authoritative contract is ../CALCULATION_SPEC.md. Do not duplicate a safe()-to-zero helper.

Public engine operations:
- validate inputs -> structured complete/incomplete/invalid result with field paths.
- derive room geometry and surface paintable areas.
- aggregate raw paint demand by snapshot variant, then compute whole-gallon purchases.
- compute application and additional labor, supplies, expenses, overhead.
- compute margin/status and target prices.
- compute service consumption unit costs independently of purchasing increments.
- compute document ledger (free template) with cent-rounded line totals.

All operations are deterministic, have no persistence/network side effects, and take explicit inputs/snapshots. Tool views never reimplement formulas. Null price, zero price, invalid assumptions, and losses are separate cases. Engine throws only for programming faults; user validation returns structured errors. Tests must exercise direct engine calls as well as UI guards.


---

Source: `tool-specs/01-free-estimate-template.md`

# Free manual painting estimate template — v2.1

## Inputs
businessInfo/customerInfo (optional text groups), projectTitle/projectAddress (optional), estimateNumber (optional), date (default today), notes/terms (optional).
lines: id, description, category (labor|materials|other), quantity (decimal >=0, initially 1), unit (text), unitSellingPrice (decimal >=0, up to 4 fractional digits).
taxEnabled boolean default false, taxRatio default 0 (0..1), explicitly user-entered; warn above 0.25. No tax lookup or claims of compliance. One manual percentage applies to all lines in v1; disclose that limitation.

## Outputs
lineTotal=HALF_UP(quantity*unitSellingPrice,2); subtotal=sum lineTotals; tax=HALF_UP(subtotal*taxRatio,2) when enabled else 0; total=subtotal+tax. Display a customer document with project/header, category/descriptions, selling quantities/prices, totals, and notes.

## Behavior
An entirely untouched empty row is ignored. A row with any entered content but missing description, quantity, or price is incomplete, not silently excluded or counted as zero. Clearing a quantity does not mean zero. Explicit zero quantity/price allowed and printed, with confirmation if entire document is no-charge. Require at least one valid described row to print a priced document; incomplete rows block priced output. Draft scope preview may be printed as DRAFT/PRICE PENDING.
Negative/nonfinite/malformed entries error. Two lines each quantity=1 and price=12.005 yield 12.01+12.01=24.02. Tax calculated on 24.02, not raw extensions. Print/PDF must reconcile exactly.
Duplicate deep-clones the draft with new IDs and clears estimateNumber; retains headers except identifier. Session/local draft storage optional but no account required. Escape text, wrap long descriptions and paginate without hiding totals. No internal cost/margin modeling. Upgrade comes after useful output, not before printing.


---

Source: `tool-specs/02-free-job-cost-calculator.md`

# Free job-cost calculator — v2.1

## Inputs
materialsMode lumpSum|itemized; lump materialsAmount >=0; itemized paintGallons>=0, paintPricePerGal>=0, suppliesAmount>=0. Gallons here are actual entered purchase quantity; do not ceil them again.
laborMode direct|hoursRate; direct laborAmount>=0 or laborHours>=0 * loadedHourlyRate>=0.
travelAmount>=0; otherExpenseLines [{id,description,amount>=0}].
overheadMode percent|flat; overheadRatio default .15 in [0,1] or flat amount>=0.
targetMarginRatio default .35 in [0,1); pricingMode solveForPrice|enterPrice; enteredPrice nullable or >=0 in cents.
At first render show empty guidance until the user supplies/confirms cost data. Explicit all-zero costs are allowed as a labeled zero-cost scenario; never confuse it with untouched inputs. Only active modes contribute; missing active inputs block results.

## Outputs
materialAmount (itemized)=paintGallons*paintPricePerGal+suppliesAmount.
labor per active mode; otherExpenses=travel+sum other lines; directCost=materials+labor+otherExpenses; overhead per active mode; totalCost=direct+overhead.
Forward: approximateTargetPrice and minimumTargetPrice from shared core; explain these are prices implied by entered costs/target, not market recommendations.
Reverse: estimatedProfit, estimatedMarginRatio, status from enteredPrice/totalCost. Never label these 'actual' results.
Always expose component costs and overhead basis. Missing price gives unpriced; zero price displays estimated loss but margin 'not defined at zero price'; below-cost positive prices show negative margin.
Changing modes never blends old hidden values. Persist inactive values for convenience only, not calculation. No account/paywall for complete answer.

## Original brief acceptance
42 hr*$32=$1,344; 22 gal*$42=$924; supplies $180; travel $100; other $75. Direct $2,623; overhead .15=$393.45; total $3,016.45; target .35 -> approx/min cent $4,640.69/$4,640.70.


---

Source: `tool-specs/03-free-interior-calculator.md`

# Free single-room interior calculator — v2.1

## Scope and inputs
Walls plus optional ceiling in one rectangular room; no multi-room, trim painting, or door painting. Opening deductions only. Explicitly label these limits next to the output.
lengthFt,widthFt >0 required; heightFt default 8 >0; includeWalls default true; includeCeiling default false; at least one enabled.
deductOpenings default true; openingMode quick|detailed. Quick doorCount/windowCount default 0, exact editable areas 20/15 ft²; detailed measured width/height/count.
coats 1..5 default 2; one shared paint variant default coverage350 and price45 (labeled sample); wasteRatio .10. Selecting ceiling means using the SAME paint variant for both surfaces; disclose before calculation. Separate ceiling product is a Pro capability.
calculateLabor default false. If enabled require user-entered loadedHourlyRate>=0, wall throughput default150 when walls enabled and ceiling throughput default120 when ceiling enabled; both divisors >0. Additional prep/cleanup hours>=0 default0, clearly shown. Explicit zero labor rate warns but is permitted as a self-performed/materials-focused scenario.

## Outputs
Gross/net wall area; deducted opening area; ceiling area only when enabled; total net paintable area; coat-adjusted area; raw gallons, purchased whole gallons, paint material cost.
wallHours=netWallArea*coats/wallThroughput; ceilingHours=ceilingArea*coats/ceilingThroughput. Sum enabled surface hours plus additional hours, multiply raw sum by loaded rate.
Total=paintCost+laborCost when labor enabled; label 'Paint + entered labor estimate; excludes other supplies, overhead, and tax'. Labor disabled: label 'Paint materials only'. Never imply a market contractor quote.

## Validation
Validate only enabled/active inputs. Invalid required geometry blocks result. Excess openings block final wall result while preserving user inputs. Inactive ceiling rate not required; disabled deductions ignore openings. No zero-coat path. Any incomplete result remains labeled incomplete.

## Fixture
20*16*9 room; walls only; 2 doors at20 and3 windows at15; 2 coats;350 coverage;.10 waste;$42/gal: net563, coat1126, raw3.538857142857..., buy4, paint $168. With ceiling enabled, area883, buy6, paint$252. At $32/hr and wall150/ceiling120, hours12.84, labor$410.88, total$662.88.


---

Source: `tool-specs/04-pro-business-settings-catalog.md`

# Pro business settings and catalog — v2.1

Inputs/entities are BusinessSettings, PaintVariant, OtherMaterial, ServiceDefinition in ../DATA_CONTRACT.md. Every setting consumed elsewhere is defined there, including waste, supplies allowance, and travel.

Outputs: validated persisted settings/catalog, explicit service models, and immutable copies for new draft RateSnapshots. Confirm sample assumptions before first priced issue. Allow incomplete setup to save, but show exactly which enabled calculations lack inputs.

Current catalog edits affect new drafts and live Price Book Health only. Existing draft snapshots survive autosave/reopen. Explicit refresh creates a preview and asks for confirmation. Issued estimates require a new revision.

Variants differing in color, sheen, coverage, or price remain separate identities. No automatic matching by name+price. Delete live variant only after warning about current service links; affected live services become incomplete. Existing snapshots keep working.
Changing default labor/production settings does not invisibly rewrite customized service assumptions: provide 'refresh service defaults' with a change preview. Current overhead/target and material variants feed live health directly.
Travel default becomes exactly one new-draft expense line. Supplies allowance is one mutually exclusive mode, not a second untracked percentage. Users can also itemize other materials; make double-counting risk visible in the component breakdown.


---

Source: `tool-specs/05-pro-room-surface-entry.md`

# Pro room and surface entry — v2.1

Inputs: Room and Surface records from ../DATA_CONTRACT.md. Each surface independently chooses enabled state, material variant, coats, waste, labor assumptions, and appropriate measurements.
Room-derived walls and ceiling use geometry. Manual wall/ceiling area, direct trim length/developed width, and door dimensions/count/sides can exist without a room. This supports door-only/trim-only jobs.
Openings can be quick or measured and deductions optional. Doorway count never implies doors painted. Automatic casing/baseboard measurement is out of v1: request user-measured trim length. Preparation tracked through named additionalLabor lines, not hidden application multipliers.

Outputs: per-surface net quantity and coat-adjusted paintable area, raw gallons, labor hours; per-variant project demand/purchases; aggregate totals consumed by summary.
Aggregate raw demand once across all surfaces sharing snapshot variant, including different coats/waste. Never combine linear feet or door counts with square feet directly. Separate colors buy separately.

Incomplete enabled surface marks entire priced estimate incomplete. A partial subtotal may be shown clearly, but final margin/issue is blocked. Disabling/removing a draft surface recalculates draft. Altering an issued surface creates a new draft revision.
Stable IDs survive reorder/rename. Copying/removing surfaces updates references, not array-position identities. Existing snapshot variants remain valid even if live catalog deletes them.


---

Source: `tool-specs/06-pro-estimate-summary.md`

# Pro estimate summary — v2.1

Inputs: complete surface quantities and active RateSnapshot, itemized other materials, supplies allowance, additionalLabor, direct expenses including travel, priceMode, proposedPrice.
Outputs: raw/per-variant demand and purchases; material components; labor components; direct cost; allocated overhead; estimatedJobCost; approximateTargetPrice; minimumTargetPrice; selected proposedPrice; estimatedProfit; estimatedMargin; status; displayed rounding adjustment if needed.
All formulas are in ../CALCULATION_SPEC.md. Never fetch live settings during a saved-draft calculation unless explicit refresh occurred.

Suggested mode uses minimumTargetPrice (ceiling to cents), tracks valid input changes, and is labeled suggested. Manual edit switches to custom; later cost changes do not overwrite price. Explicit 'use target price' restores suggested mode. Incomplete surfaces disable final margin/issue even if custom price exists. Removing all surfaces yields no final priced job; preserve custom input but do not show a complete 100% margin.

Warn on cost changes after selecting a custom price and expose old/new cost. Keep negative profit. Missing versus zero price follows core states; all-zero quoted jobs require explicit no-charge confirmation.
Saving persists a draft; issuing freezes a revision including computed and customer-facing output. Changing rates is an explicit operation, not a side effect of saving. Taxes not modeled in Pro v1; label price pre-tax.


---

Source: `tool-specs/07-pro-price-book-health.md`

# Pro Price Book Health — v2.1

Inputs: ServiceDefinition records, current paint variants, current overheadRatio and targetMarginRatio. Per-service fields supply coats, paint consumption geometry, labor assumptions, additional labor, supplies, and direct expense allocations. See core section 8 for complete derivation.

Outputs per row:
- Current selling price/unit (nullable).
- Paint consumption, supplies, labor, direct expenses, and overhead per unit.
- Modeled cost/unit and estimated profit/unit.
- MarginRatio and below_cost/below_target/at_target/above_target/unpriced/zero_price/incomplete status.
- Approximate target price and minimum cent price meeting target.
- Assumptions breakdown including product/color, coverage, coats, waste, surface dimensions, production units, overhead basis, and manually allocated expenses.

No whole-gallon rounding per unit. Clearly disclose consumption-cost basis and project purchasing/setup differences. A blank required service assumption produces incomplete, not a low or zero cost. Null price prompts entry; zero price identifies no-charge pricing; losses are retained.

Recalculate current health when material price, overhead, target, or explicit service fields change. Show material-price before/after comparison only against a captured prior service calculation; old issued estimates remain untouched. Live table is not populated with hardcoded homepage costs.

Example fixture: wall $1.80/ft², two coats, paint $42/350 coverage, waste.10, production150, labor$32, overhead.15, no extra allocations. Consumption cost .264/ft²; labor .426666...; modeled cost .794266666...; margin55.874074...%; display55.9%. This is a complete forward-derived example, not the homepage42.2% sample.

Marketing policy: follow the final policy in CALCULATION_SPEC.md. Existing homepage values are illustrative, not default-engine outputs. Never reverse-engineer business assumptions to reproduce them. Real product previews must use a complete saved example and its actual results.


---

Source: `tool-specs/08-pro-estimate-output.md`

# Pro customer estimate output — v2.1

Input: issued EstimateRevision customerDocumentSnapshot, or a deliberately labeled draft preview assembled using an allow-list.
Allow-list: estimate number/date, business/customer info, project title/address, scope descriptions with surfaces/coats, selling total proposedPrice, currency, notes/terms, revision label, tax-not-included notice, draft/issued status. Logo optional and safely decoded; no script-capable embedded content.
Excluded by construction: purchase costs, loaded rates, hours costing, overhead allocation, internal quantities/cost breakdown, estimated profit/margin, catalog settings, actuals, payment/license data. Describe scope quantities only when deliberately in customer scope.

V1 customer document uses one project selling total; no invented distribution across lines. Detailed line-item selling prices require an explicit later model; internal cost lines are not selling line prices.

Priced output requires complete valid inputs and proposedPrice (zero allowed only after explicit no-charge confirmation). Unpriced/incomplete draft can render scope-only with DRAFT and PRICE PENDING, never misleading zero. Issued documents never recalculate using today's catalog/engine.

Print/PDF: retain all scope text, repeat table headers where applicable, prevent overlap/clipped totals, distinguish internal view from customer preview, remove controls from print. Tax notice: 'Prices exclude taxes; taxes are not calculated by this tool.' Do not claim tax-complete invoicing. Long descriptions and malicious-looking text render safely as literal text. Test multi-page output and omitted-logo cases.


---

Source: `tool-specs/09-pro-actual-cost-review.md`

# Pro actual-cost review — v2.1

Inputs: ActualReview linked to a specific issued revision, with confirmed flags and nullable amounts for materials, labor, direct expenses, and overhead. Labor direct/hoursRate is mutually exclusive. Overhead uses explicitly confirmed baseline allocation or entered actual flat amount.

In progress: output entered category costs, recorded subtotal, and missing-category indicators. Category variance may show only for confirmed categories. Suppress final profit, margin, and total variance.
Final: require all categories confirmed (zero valid); actualCost=sum four categories. profitAgainstOriginalQuote=baseline proposedPrice-actualCost; margin = profit / baselinePrice when baselinePrice > 0, regardless of the sign of profit; when baselinePrice = 0, margin = null (undefined); variance=actual-estimated per category/total. Original zero price yields loss amount with undefined margin, not unpriced.

Label baseline overhead as allocated, not measured actual overhead. Label revenue as original quote, not cash received. This version does not model change orders, discounts after acceptance, collections, or actual revenue; disclose that boundary.
Saving/editing actuals never changes baseline inputs, issued outputs, or rates. Recompute from current actual fields without accumulation. New estimate revisions do not automatically rebase actual reviews. Changing baseline requires explicit selection and confirmation, preserving prior review history or a separate new review. Backup includes linked records and IDs.

Regression examples: baseline price $3,200 and final costs $3,500 yield profit -$300 and margin -9.375% (display -9.4%). Baseline price $0 and costs $100 yield profit -$100 and margin null. Do not suppress a loss when the baseline price is positive. A missing baseline price cannot belong to a valid issued revision; reject it as an invalid baseline rather than treating it as zero.


---

Source: `tool-specs/10-pro-backup-restore.md`

# Pro backup/restore — v2.1

The authoritative envelope, IDs, validation, import modes, limits, and conflict policy are in ../DATA_CONTRACT.md.

Export complete projects/revisions/snapshots/actuals, catalogs/services/settings and required local assets with schema/engine versions. Exclude license secrets and payment data. Explain that browser-local persistence is not a backup and may be lost if browser data is cleared.

Import flow:
1. Parse file within supported limits, without mutating storage.
2. Validate complete shape, types/ranges, enums, graph references, versions, and unique IDs.
3. Choose restore/merge (default), import as copies, or replace all.
4. Preview additions/skips/conflicts; collect explicit conflict choices. No name+price matching.
5. Provide pre-import backup for destructive replacement.
6. Commit transaction; on any error rollback and report 'not imported'.
7. Confirm record counts actually committed; record provenance.

Repeated identical restore skips identical records; conflicting locally edited data requires choices. Repeated import-as-copies skips prior source IDs for same export unless explicitly duplicated. New copied IDs remap all children/actual baselines, not only project IDs.

Test quota failure, transaction failure, truncated file, duplicate IDs, missing snapshots, dangling actual baseline, unsupported version, catalog ID conflict, repeat import, and live-deleted catalog items embedded in snapshots. Every failure leaves original committed store unchanged.


---

Source: `ACCEPTANCE_TESTS.md`

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


---

Source: `ACCESS_SPEC.md`

# Paid access boundary — v2.1

This package specifies estimation logic, not a chosen payment integration. Before coding paid delivery, select a provider and document its verified payment-to-license flow from current official documentation.
Required: hosted checkout, server/provider-verified entitlement, no secret keys in client bundles, no unlock based only on success URL, idempotent delivery, failed/cancelled payment behavior, returning-buyer recovery, refund/revocation policy, and clear device/offline terms. Local-first project storage does not eliminate the need for external payment infrastructure.
If using offline signed licenses, signing must occur in a trusted service and client verification uses a public key; browser access checks alone cannot provide strong anti-copy protection. Do not claim unbreakable DRM. No app account required is compatible with purchaser email/license recovery, which must be disclosed separately.
Do not implement a mock localStorage paid=true flag as completed access control. Backup restores project data, not proof of purchase. Purchase acceptance tests are separate from this arithmetic package and remain a launch gate.


---

Source: `IMPLEMENTATION_PROMPT.md`

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


---

Source: `CHANGELOG.md`

# v2.1 final review changes
- Explicitly gate actual margin on baselinePrice > 0, regardless of profit sign.
- Preserve loss amount and null margin on explicit zero baseline price; reject missing issued baseline price.
- Finalize homepage sample figures as illustrative, without tuning defaults to match.
- Add two actual-review numerical regressions; keep production/behavioral validation separate.
- Documentation version changes to 2.1; persisted schemaVersion remains 2.

# v2.0 changes from the originally uploaded package
- Replaced silent safe-to-zero policy with typed missing/invalid/zero states.
- Standardized decimal strings and stored ratio fields.
- Defined nearest target price versus upward-to-cent minimum meeting target.
- Split internal high-precision cost math from cent-rounded document arithmetic.
- Added per-surface variants/coats, trim developed width, door sides/geometry/time, prep lines, and standalone surfaces.
- Restored exact 20/15 ft² quick opening defaults and optional deductions.
- Added missing travel, waste, supplies, color/sheen, and service-model inputs.
- Defined Price Book Health as consumption-based, with explicit direct expense allocation; removed claims that reverse-solving homepage values proves the model.
- Added immutable issued revisions, explicit rate refresh and engine-version history.
- Separated partial actuals from complete profit review.
- Replaced contradictory import-new/upsert rules with defined import modes, provenance, graph remapping and transactions.
- Restored itemized free job-cost inputs; documented single-room free interior launch reduction.
- Added customer pre-tax output boundary and actual-revenue limitation.
- Added acceptance fixtures, numerical oracle, lifecycle tests and purchase-access gate.
