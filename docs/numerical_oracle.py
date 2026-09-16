"""Independent numerical oracle for Painting Pricing Calculator.

This module is a from-scratch reimplementation of CALCULATION_SPEC.md's
formulas, written directly against that specification. It NEVER imports,
calls, transpiles, or otherwise depends on any file under src/ -- it is a
genuinely separate implementation used to differentially test the real
TypeScript engine, not a wrapper around it.

Arithmetic uses Python's fractions.Fraction exclusively -- true exact
rational arithmetic, with NO precision limit and NO truncation of repeating
decimals at any intermediate step (unlike a fixed-precision Decimal, which
must round any non-terminating quotient to its configured precision, even
if a later operation would have exactly cancelled the repeating part). This
matters: differential fuzzing against an earlier Decimal-based version of
this oracle (precision 60) found that IT ALSO produced a handful of wrong
answers at exact HALF_UP rounding ties, for the same reason production's
Decimal.js (precision 50, later 100) did -- premature rounding of a
repeating-decimal intermediate before a later multiplication that would
have exactly cancelled it. Fraction has no such failure mode: every
arithmetic operation (+, -, *, /) on two Fractions is exact, by
construction, for as many digits as the true value requires. Rounding to
cents (HALF_UP) happens ONLY at the explicit `half_up`/`money`/
`ceil_to_unit` calls, matching CALCULATION_SPEC.md's "round only at
display/purchase boundaries" rule exactly -- and correctly, with zero
possibility of a precision-induced tie flip, since there is no precision
to run out of. This is the same technique docs/verify_reference.py already
used successfully; this module extends it to the full project-assembly
pipeline, service health, and actuals.

This file intentionally has zero third-party dependencies (Python stdlib
only), matching docs/verify_reference.py's existing constraint, so it runs
in any clean-install environment without a pip step.
"""
from __future__ import annotations

from fractions import Fraction as Frac
from dataclasses import dataclass
from typing import Optional, Union, Literal

# ---------------------------------------------------------------------------
# The oracle's exact numeric type. `D` is kept as the type alias name for
# readability at call sites (mirrors production's `Dec`), but it is a
# Fraction, not a decimal.Decimal -- see module docstring for why.
# ---------------------------------------------------------------------------
D = Frac


class OracleRejected(Exception):
    """Raised when an input is not a well-formed finite decimal per the
    production parsing grammar (^[+-]?(\\d+)(\\.(\\d+))?$), or a formula
    precondition (e.g. dividing by a non-positive throughput) is violated."""


def D_(value: Union[str, int, "Frac"]) -> Frac:
    """Strict exact-decimal construction: rejects Infinity/-Infinity/NaN,
    float literals (binary imprecision -- a bug class this oracle exists to
    catch, not reproduce), and any string that isn't a plain finite decimal
    literal. `Fraction("1685.8")` parses a decimal string EXACTLY (as
    16858/10, auto-reduced) -- this is not an approximation the way
    `Decimal("1685.8")` at some fixed precision can eventually become after
    arithmetic; a Fraction never loses precision for +, -, *, /."""
    if isinstance(value, float):
        raise OracleRejected(f"refusing to construct an exact value from a float literal: {value!r}")
    if isinstance(value, Frac):
        return value
    if isinstance(value, int):
        return Frac(value)
    s = str(value).strip()
    if s == "":
        raise OracleRejected("empty string is not a valid decimal")
    low = s.lower()
    if low in ("inf", "+inf", "-inf", "infinity", "+infinity", "-infinity", "nan", "+nan", "-nan"):
        raise OracleRejected(f"non-finite value rejected: {value!r}")
    try:
        return Frac(s)
    except (ValueError, ZeroDivisionError) as e:
        raise OracleRejected(f"not a valid decimal literal: {value!r}") from e


ZERO = Frac(0)
ONE = Frac(1)
HUNDRED = Frac(100)


def half_up(x: Frac, places: int) -> Frac:
    """Exact HALF_UP rounding to `places` decimal digits, using pure integer
    arithmetic on the Fraction's own numerator/denominator -- no float, no
    fixed-precision Decimal, no possibility of a precision-induced tie flip.
    Ties round away from zero (production's Decimal.js ROUND_HALF_UP
    semantics, and CALCULATION_SPEC's "no banker's rounding" rule)."""
    x = D_(x)
    sign = -1 if x < 0 else 1
    ax = abs(x)
    scale = 10 ** places
    # floor(ax*scale + 1/2), done with exact integers: (2*num*scale + den) // (2*den)
    rounded_int = (2 * ax.numerator * scale + ax.denominator) // (2 * ax.denominator)
    return Frac(sign * rounded_int, scale)


def money(x: Frac) -> Frac:
    return half_up(x, 2)


def ceil_to_unit(x: Frac) -> Frac:
    """Exact ceiling to the nearest whole unit -- production's ceilDecimal,
    used for paint-gallon purchasing. No epsilon: 2.9999999999 -> 3,
    3.0000000001 -> 4, exactly 3 -> 3. Pure integer floor-division, exact."""
    x = D_(x)
    return Frac(-(-x.numerator // x.denominator))


def no_negative_zero(x: Frac) -> Frac:
    """Guards against the classic '-0' display bug. A Fraction never carries
    a signed zero the way IEEE floats or some Decimal representations can,
    but this is kept for symmetry with the production-facing API and as an
    explicit assertion point in tests."""
    return ZERO if x == 0 else x


def to_fixed_string(x: Frac, places: int = 2) -> str:
    """Exact fixed-width decimal string with exactly `places` digits after
    the point -- like JS's `.toFixed(places)`, but exact (no float, no
    fixed-precision Decimal). Requires that `x`'s denominator divides
    10**places evenly, i.e. that `x` has ALREADY been rounded to (at most)
    `places` decimal digits via half_up()/money()/ceil_to_unit() -- passing
    a raw, not-yet-rounded value here raises loudly rather than silently
    truncating extra digits, which is exactly the class of bug this oracle
    exists to prevent. This never drops or infers trailing zeros the way a
    naive Fraction-to-minimal-decimal conversion would (e.g. `money(2623)`
    must render as "2623.00", not "2623")."""
    x = D_(x)
    scale = 10 ** places
    scaled = x * scale
    if scaled.denominator != 1:
        raise OracleRejected(
            f"value {x} ({float(x)}) is not an exact multiple of 10^-{places} -- "
            "call half_up(x, places)/money(x)/ceil_to_unit(x) before formatting"
        )
    n = scaled.numerator
    sign = "-" if n < 0 else ""
    n = abs(n)
    if places == 0:
        return sign + str(n)
    s = str(n).zfill(places + 1)
    return sign + s[:-places] + "." + s[-places:]


def money_str(x: Frac) -> str:
    """Convenience: round to cents, then render as an exact "-?D+.DD" string
    (never scientific notation, never a dropped/extra trailing zero)."""
    return to_fixed_string(money(x), 2)


def to_minimal_string(x: Frac) -> str:
    """Exact decimal string using the FEWEST digits that exactly represent
    `x` (no forced trailing zeros, no forced decimal point for a whole
    number) -- for echoing an already-well-formed INPUT value (e.g. back
    into a JSON fixture for a test harness to re-parse), where any string
    that parses back to the same exact value is equally correct, unlike
    `to_fixed_string`, which is for the strict fixed-width comparison of a
    FINAL, already-rounded OUTPUT value against production's `.toFixed(n)`.
    Requires a terminating (2^a * 5^b denominator) value, same as
    `to_fixed_string` -- raises loudly rather than silently truncating a
    repeating decimal."""
    x = D_(x)
    num, den = x.numerator, x.denominator
    d = den
    twos = 0
    while d % 2 == 0:
        d //= 2
        twos += 1
    fives = 0
    while d % 5 == 0:
        d //= 5
        fives += 1
    if d != 1:
        raise OracleRejected(f"value {x} ({float(x)}) does not terminate in decimal")
    places = max(twos, fives)
    return to_fixed_string(x, places)


# ---------------------------------------------------------------------------
# Part 3 -- Geometry (CALCULATION_SPEC.md Section 3)
# ---------------------------------------------------------------------------

def gross_wall_area(length_ft: Frac, width_ft: Frac, height_ft: Frac) -> Frac:
    return (D_(length_ft) + D_(width_ft)) * 2 * D_(height_ft)


def ceiling_area(length_ft: Frac, width_ft: Frac) -> Frac:
    return D_(length_ft) * D_(width_ft)


def quick_opening_area(door_count: int, door_area_ft2: Frac, window_count: int, window_area_ft2: Frac) -> Frac:
    return D_(door_count) * D_(door_area_ft2) + D_(window_count) * D_(window_area_ft2)


def detailed_opening_area(openings: list[tuple[Frac, Frac, int]]) -> Frac:
    """Each opening: (width_ft, height_ft, count)."""
    total = ZERO
    for w, h, count in openings:
        total += D_(w) * D_(h) * D_(count)
    return total


@dataclass
class NetWallResult:
    area: Frac
    valid: bool


def net_wall_area(gross: Frac, opening_area: Frac, deduction_enabled: bool) -> NetWallResult:
    if not deduction_enabled:
        return NetWallResult(area=D_(gross), valid=True)
    gross_d, opening_d = D_(gross), D_(opening_area)
    if opening_d > gross_d:
        return NetWallResult(area=gross_d - opening_d, valid=False)
    return NetWallResult(area=gross_d - opening_d, valid=True)


def trim_paintable_area(length_ft: Frac, developed_width_ft: Frac) -> Frac:
    return D_(length_ft) * D_(developed_width_ft)


def door_paintable_area(count: int, width_ft: Frac, height_ft: Frac, painted_sides: Literal[1, 2]) -> Frac:
    return D_(count) * D_(width_ft) * D_(height_ft) * D_(painted_sides)


# ---------------------------------------------------------------------------
# Part 4/5 -- Paint demand/purchasing and labor (Sections 4, 5)
# ---------------------------------------------------------------------------

def raw_demand_gal(area_ft2: Frac, coats: int, waste_ratio: Frac, coverage_ft2_per_gal: Frac) -> Frac:
    coverage = D_(coverage_ft2_per_gal)
    if coverage <= 0:
        raise OracleRejected("coverage must be a positive divisor")
    return D_(area_ft2) * coats * (ONE + D_(waste_ratio)) / coverage


def purchased_gallons(total_raw_gal: Frac) -> Frac:
    return ceil_to_unit(D_(total_raw_gal))


def wall_or_ceiling_hours(net_area_ft2: Frac, coats: int, throughput_ft2_per_hour_per_coat: Frac) -> Frac:
    t = D_(throughput_ft2_per_hour_per_coat)
    if t <= 0:
        raise OracleRejected("throughput must be a positive divisor")
    return D_(net_area_ft2) * coats / t


def trim_hours(trim_length_ft: Frac, coats: int, throughput_linear_ft_per_hour_per_coat: Frac) -> Frac:
    t = D_(throughput_linear_ft_per_hour_per_coat)
    if t <= 0:
        raise OracleRejected("throughput must be a positive divisor")
    return D_(trim_length_ft) * coats / t


def door_hours(count: int, painted_sides: Literal[1, 2], coats: int, hours_per_side_per_coat: Frac) -> Frac:
    return D_(hours_per_side_per_coat) * count * painted_sides * coats


# ---------------------------------------------------------------------------
# Part 6 -- Materials, expenses, overhead (Section 5)
# ---------------------------------------------------------------------------

SuppliesMode = Literal["none", "flat", "paintPercent"]


def supplies_allowance(mode: SuppliesMode, paint_cost: Frac, flat_amount: Optional[Frac] = None,
                        paint_percent_ratio: Optional[Frac] = None) -> Frac:
    if mode == "none":
        return ZERO
    if mode == "flat":
        return D_(flat_amount) if flat_amount is not None else ZERO
    if mode == "paintPercent":
        ratio = D_(paint_percent_ratio) if paint_percent_ratio is not None else ZERO
        return D_(paint_cost) * ratio
    raise OracleRejected(f"unknown supplies allowance mode: {mode!r}")


def other_material_cost(lines: list[tuple[Frac, Frac]]) -> Frac:
    """Each line: (quantity, unit_cost)."""
    total = ZERO
    for qty, unit_cost in lines:
        total += D_(qty) * D_(unit_cost)
    return total


def materials_total(paint_cost: Frac, other_materials_cost: Frac, allowance: Frac) -> Frac:
    return D_(paint_cost) + D_(other_materials_cost) + D_(allowance)


def other_expenses_total(amounts: list[Frac]) -> Frac:
    total = ZERO
    for a in amounts:
        total += D_(a)
    return total


def direct_cost(materials: Frac, labor: Frac, other_expenses: Frac) -> Frac:
    return D_(materials) + D_(labor) + D_(other_expenses)


def overhead_amount(direct_cost_value: Frac, overhead_ratio: Frac) -> Frac:
    return D_(direct_cost_value) * D_(overhead_ratio)


def estimated_job_cost(direct_cost_value: Frac, overhead: Frac) -> Frac:
    return D_(direct_cost_value) + D_(overhead)


def additional_labor_cost(lines: list[tuple[Frac, Frac]]) -> Frac:
    """Each line: (hours, loaded_hourly_rate)."""
    total = ZERO
    for hours, rate in lines:
        total += D_(hours) * D_(rate)
    return total


# ---------------------------------------------------------------------------
# Part 7 -- Pricing, margin, markup, profit (Section 6 -- "most
# safety-critical module")
# ---------------------------------------------------------------------------

MAX_REQUIRED_PRICE = Frac(1000000000)

PriceStatus = Literal["unpriced", "zero_price", "below_cost", "below_target", "at_target", "above_target"]


def required_price_raw(cost: Frac, target_margin_ratio: Frac) -> Union[Frac, Literal["out_of_supported_range"]]:
    cost_d, target_d = D_(cost), D_(target_margin_ratio)
    if target_d >= 1 or target_d < 0:
        raise OracleRejected("targetMarginRatio out of [0,1) range")
    raw = cost_d / (ONE - target_d)
    if raw > MAX_REQUIRED_PRICE:
        return "out_of_supported_range"
    return raw


def approx_price(raw: Frac) -> Frac:
    return money(raw)


def minimum_target_price(raw: Frac) -> Frac:
    """The minimum cent value that is >= raw -- guarantees margin(price) >=
    target, unlike nearest-cent rounding (approx_price), which can round
    down and silently undershoot the target margin."""
    cents = ceil_to_unit(D_(raw) * HUNDRED)
    return cents / HUNDRED


def margin(price: Frac, cost: Frac) -> Optional[Frac]:
    price_d = D_(price)
    if not price_d > 0:
        return None
    return (price_d - D_(cost)) / price_d


def markup(price: Frac, cost: Frac) -> Optional[Frac]:
    cost_d = D_(cost)
    if not cost_d > 0:
        return None
    return (D_(price) - cost_d) / cost_d


@dataclass
class PriceResult:
    profit: Optional[Frac]
    margin_ratio: Optional[Frac]
    status: PriceStatus
    approx_price: Optional[Frac]
    minimum_target_price: Optional[Frac]


def evaluate_price(cost: Frac, price: Optional[Frac], target_margin_ratio: Frac) -> PriceResult:
    cost_d = D_(cost)
    raw = required_price_raw(cost_d, target_margin_ratio)
    approx = None if raw == "out_of_supported_range" else approx_price(raw)
    min_target = None if raw == "out_of_supported_range" else minimum_target_price(raw)

    if price is None:
        return PriceResult(profit=None, margin_ratio=None, status="unpriced",
                            approx_price=approx, minimum_target_price=min_target)

    price_d = D_(price)
    if price_d == 0:
        # spec: explicit price=0 -> profit=-cost, margin=null, status=zero_price.
        return PriceResult(profit=-cost_d, margin_ratio=None, status="zero_price",
                            approx_price=approx, minimum_target_price=min_target)

    profit = price_d - cost_d
    margin_ratio = margin(price_d, cost_d)
    target_d = D_(target_margin_ratio)
    if profit < 0:
        status: PriceStatus = "below_cost"
    elif margin_ratio < target_d:
        status = "below_target"
    elif margin_ratio == target_d:
        status = "at_target"
    else:
        status = "above_target"

    return PriceResult(profit=profit, margin_ratio=margin_ratio, status=status,
                        approx_price=approx, minimum_target_price=min_target)


# ---------------------------------------------------------------------------
# Part 11 -- Full project assembly (mirrors src/engine/estimate.ts +
# estimateAssembly.ts's cost/overhead/price sequence exactly, independently)
# ---------------------------------------------------------------------------

@dataclass
class SurfaceInput:
    id: str
    enabled: bool
    kind: Literal["wall", "ceiling", "trim", "door"]
    paint_variant_id: str
    coats: int
    waste_ratio: Frac
    loaded_hourly_rate: Frac
    rate_or_throughput: Frac  # wall/ceiling/trim: throughput; door: hours/side/coat
    # geometry, by kind:
    area_ft2: Optional[Frac] = None            # wall/ceiling
    trim_length_ft: Optional[Frac] = None      # trim
    developed_width_ft: Optional[Frac] = None  # trim
    door_count: Optional[int] = None           # door
    door_width_ft: Optional[Frac] = None       # door
    door_height_ft: Optional[Frac] = None      # door
    painted_sides: Optional[Literal[1, 2]] = None  # door
    valid: bool = True


def surface_paintable_area(s: SurfaceInput) -> Frac:
    if s.kind in ("wall", "ceiling"):
        return D_(s.area_ft2)
    if s.kind == "trim":
        return trim_paintable_area(s.trim_length_ft, s.developed_width_ft)
    if s.kind == "door":
        return door_paintable_area(s.door_count, s.door_width_ft, s.door_height_ft, s.painted_sides)
    raise OracleRejected(f"unknown surface kind {s.kind!r}")


def surface_labor_hours(s: SurfaceInput) -> Frac:
    if s.kind in ("wall", "ceiling"):
        return wall_or_ceiling_hours(s.area_ft2, s.coats, s.rate_or_throughput)
    if s.kind == "trim":
        return trim_hours(s.trim_length_ft, s.coats, s.rate_or_throughput)
    if s.kind == "door":
        return door_hours(s.door_count, s.painted_sides, s.coats, s.rate_or_throughput)
    raise OracleRejected(f"unknown surface kind {s.kind!r}")


@dataclass
class VariantPricing:
    coverage_per_gal: Frac
    price_per_gal: Frac


@dataclass
class ProjectAggregateResult:
    valid: bool
    purchases: dict  # variant_id -> {raw_gal, purchased_gal, cost}
    materials_cost: Frac
    labor_hours: Frac
    labor_cost: Frac


def aggregate_project_surfaces(surfaces: list[SurfaceInput], variant_pricing: dict[str, VariantPricing]) -> ProjectAggregateResult:
    enabled = [s for s in surfaces if s.enabled]
    if len(enabled) == 0 or any(not s.valid for s in enabled):
        return ProjectAggregateResult(valid=False, purchases={}, materials_cost=ZERO, labor_hours=ZERO, labor_cost=ZERO)

    raw_by_variant: dict[str, Frac] = {}
    labor_hours = ZERO
    labor_cost = ZERO
    for s in enabled:
        area = surface_paintable_area(s)
        hours = surface_labor_hours(s)
        pricing = variant_pricing.get(s.paint_variant_id)
        coverage = pricing.coverage_per_gal if pricing else Frac(350)
        demand = raw_demand_gal(area, s.coats, s.waste_ratio, coverage)
        raw_by_variant[s.paint_variant_id] = raw_by_variant.get(s.paint_variant_id, ZERO) + demand
        labor_hours += hours
        labor_cost += hours * D_(s.loaded_hourly_rate)

    purchases = {}
    materials_cost = ZERO
    for variant_id, raw_gal in raw_by_variant.items():
        purchased = purchased_gallons(raw_gal)
        price_per_gal = variant_pricing[variant_id].price_per_gal if variant_id in variant_pricing else ZERO
        cost = purchased * D_(price_per_gal)
        purchases[variant_id] = {"raw_gal": raw_gal, "purchased_gal": purchased, "cost": cost}
        materials_cost += cost

    return ProjectAggregateResult(valid=True, purchases=purchases, materials_cost=materials_cost,
                                   labor_hours=labor_hours, labor_cost=labor_cost)


@dataclass
class ProjectEstimateResult:
    valid: bool
    materials_cost: Optional[Frac] = None
    labor_cost: Optional[Frac] = None
    direct_cost: Optional[Frac] = None
    overhead: Optional[Frac] = None
    job_cost: Optional[Frac] = None
    price_result: Optional[PriceResult] = None


def assemble_project_estimate(
    surfaces: list[SurfaceInput],
    variant_pricing: dict[str, VariantPricing],
    additional_labor_lines: list[tuple[Frac, Frac]],
    other_material_lines: list[tuple[Frac, Frac]],
    supplies_mode: SuppliesMode,
    supplies_flat_amount: Optional[Frac],
    supplies_paint_percent_ratio: Optional[Frac],
    other_expense_amounts: list[Frac],
    overhead_ratio: Frac,
    target_margin_ratio: Frac,
    price: Optional[Frac],
) -> ProjectEstimateResult:
    agg = aggregate_project_surfaces(surfaces, variant_pricing)
    if not agg.valid:
        return ProjectEstimateResult(valid=False)

    allowance = supplies_allowance(supplies_mode, agg.materials_cost, supplies_flat_amount, supplies_paint_percent_ratio)
    other_mat = other_material_cost(other_material_lines)
    materials = materials_total(agg.materials_cost, other_mat, allowance)

    add_labor = additional_labor_cost(additional_labor_lines)
    labor = agg.labor_cost + add_labor

    expenses = other_expenses_total(other_expense_amounts)

    dc = direct_cost(materials, labor, expenses)
    oh = overhead_amount(dc, overhead_ratio)
    jc = estimated_job_cost(dc, oh)

    price_result = evaluate_price(jc, price, target_margin_ratio)

    return ProjectEstimateResult(valid=True, materials_cost=materials, labor_cost=labor,
                                  direct_cost=dc, overhead=oh, job_cost=jc, price_result=price_result)


# ---------------------------------------------------------------------------
# Part 12 -- Price Book Health / service unit costing (Section 8)
# ---------------------------------------------------------------------------

ServiceKind = Literal["wall", "ceiling", "trim", "door"]


@dataclass
class ServiceUnitCost:
    paint_consumption_cost_per_unit: Frac
    materials_per_unit: Frac
    labor_hours_per_unit: Frac
    labor_cost_per_unit: Frac
    direct_cost_per_unit: Frac
    overhead_per_unit: Frac
    modeled_cost_per_unit: Frac


def compute_service_unit_cost(
    kind: ServiceKind,
    area_or_length_per_unit: Frac,   # ft2 per unit for wall/ceiling/door; ft per unit for trim
    coats: int,
    waste_ratio: Frac,
    coverage_ft2_per_gal: Frac,
    price_per_gal: Frac,
    application_hours_per_unit: Frac,
    additional_labor_hours_per_unit: Frac,
    loaded_hourly_rate: Frac,
    supplies_cost_per_unit: Frac,
    direct_expense_per_unit: Frac,
    overhead_ratio: Frac,
) -> ServiceUnitCost:
    """Fractional, consumption-based costing -- deliberately NEVER rounds to
    a whole purchased can the way a real job does; Price Book Health must
    reflect the true fractional cost per unit, not whole-can rounding noise
    (CALCULATION_SPEC §8). Mirrors src/engine/serviceHealth.ts's
    computeServiceUnitCost field-for-field."""
    raw_gal_per_unit = raw_demand_gal(area_or_length_per_unit, coats, waste_ratio, coverage_ft2_per_gal)
    paint_cost_per_unit = raw_gal_per_unit * D_(price_per_gal)
    materials_per_unit = paint_cost_per_unit + D_(supplies_cost_per_unit)
    labor_hours_per_unit = D_(application_hours_per_unit) + D_(additional_labor_hours_per_unit)
    labor_cost_per_unit = labor_hours_per_unit * D_(loaded_hourly_rate)
    dc_per_unit = materials_per_unit + labor_cost_per_unit + D_(direct_expense_per_unit)
    oh_per_unit = overhead_amount(dc_per_unit, overhead_ratio)
    modeled = estimated_job_cost(dc_per_unit, oh_per_unit)
    return ServiceUnitCost(
        paint_consumption_cost_per_unit=paint_cost_per_unit,
        materials_per_unit=materials_per_unit,
        labor_hours_per_unit=labor_hours_per_unit,
        labor_cost_per_unit=labor_cost_per_unit,
        direct_cost_per_unit=dc_per_unit,
        overhead_per_unit=oh_per_unit,
        modeled_cost_per_unit=modeled,
    )


def evaluate_service_health(unit_cost: ServiceUnitCost, current_selling_price: Optional[Frac], target_margin_ratio: Frac) -> PriceResult:
    return evaluate_price(unit_cost.modeled_cost_per_unit, current_selling_price, target_margin_ratio)


# ---------------------------------------------------------------------------
# Part 13 -- Actual-cost review (Section actuals)
# ---------------------------------------------------------------------------

MAX_AGGREGATE_MONETARY = Frac(1000000000)  # matches src/engine/parse.ts exactly

ActualReviewState = Literal["in_progress", "final", "out_of_supported_range"]


@dataclass
class ActualCategory:
    confirmed: bool
    amount: Optional[Frac]


@dataclass
class ActualReviewResult:
    state: ActualReviewState
    confirmed_categories: int
    recorded_cost_so_far: Frac
    actual_total: Optional[Frac]
    profit_vs_original: Optional[Frac]
    actual_margin: Optional[Frac]
    variance: Optional[Frac]


def _category_value(c: ActualCategory) -> Optional[Frac]:
    return c.amount if (c.confirmed and c.amount is not None) else None


def evaluate_actual_review(
    materials: ActualCategory, labor: ActualCategory, other_expenses: ActualCategory, overhead: ActualCategory,
    baseline_price: Frac, baseline_cost: Frac,
) -> ActualReviewResult:
    """Mirrors src/engine/actuals.ts's evaluateActualReview exactly: margin
    is gated on baselinePrice > 0 regardless of profit's sign (a loss must
    still show a real negative margin, never suppressed); finalization
    requires ALL FOUR categories confirmed with a non-null amount; and even
    then, if the four confirmed amounts SUM past MAX_AGGREGATE_MONETARY, the
    state is 'out_of_supported_range', not a fabricated 'final' total."""
    categories = [materials, labor, other_expenses, overhead]
    confirmed_categories = sum(1 for c in categories if c.confirmed and c.amount is not None)

    recorded = ZERO
    for c in categories:
        v = _category_value(c)
        if v is not None:
            recorded += v

    if confirmed_categories < 4:
        return ActualReviewResult(state="in_progress", confirmed_categories=confirmed_categories,
                                   recorded_cost_so_far=recorded, actual_total=None,
                                   profit_vs_original=None, actual_margin=None, variance=None)

    if recorded > MAX_AGGREGATE_MONETARY:
        return ActualReviewResult(state="out_of_supported_range", confirmed_categories=confirmed_categories,
                                   recorded_cost_so_far=recorded, actual_total=None,
                                   profit_vs_original=None, actual_margin=None, variance=None)

    baseline_price_d = D_(baseline_price)
    actual_total = recorded
    profit = baseline_price_d - actual_total
    margin_ratio = (profit / baseline_price_d) if baseline_price_d > 0 else None
    variance = actual_total - D_(baseline_cost)

    return ActualReviewResult(state="final", confirmed_categories=confirmed_categories,
                               recorded_cost_so_far=recorded, actual_total=actual_total,
                               profit_vs_original=profit, actual_margin=margin_ratio, variance=variance)


# ---------------------------------------------------------------------------
# Part 8 -- Free estimate-template document totals (line-then-tax rounding)
# ---------------------------------------------------------------------------

@dataclass
class DocumentTotals:
    line_totals: list[Frac]
    subtotal: Frac
    tax: Frac
    total: Frac


def compute_document_totals(lines: list[tuple[Frac, Frac]], tax_enabled: bool, tax_ratio: Frac) -> DocumentTotals:
    """Each line: (quantity, unit_price). Deliberately rounds EACH line to
    the cent first, then sums the rounded lines for the subtotal, then rounds
    tax on that rounded subtotal -- NOT round(sum(raw)). This is the
    sum-of-rounded-lines rule from CALCULATION_SPEC §7, and it can legitimately
    differ from round(sum(raw)) by a cent (e.g. two $12.005 lines -> $24.02,
    not $24.01)."""
    line_totals = [money(D_(qty) * D_(unit_price)) for qty, unit_price in lines]
    subtotal = sum(line_totals, ZERO)
    tax = money(subtotal * D_(tax_ratio)) if tax_enabled else ZERO
    total = subtotal + tax
    return DocumentTotals(line_totals=line_totals, subtotal=subtotal, tax=tax, total=total)


__all__ = [n for n in dir() if not n.startswith("_")]
