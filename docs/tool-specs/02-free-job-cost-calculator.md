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
