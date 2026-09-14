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
