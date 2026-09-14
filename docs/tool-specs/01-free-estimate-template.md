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
