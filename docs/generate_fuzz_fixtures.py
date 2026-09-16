"""Deterministic seeded fixture generator for differential fuzzing between
the independent Python oracle (docs/numerical_oracle.py) and the production
TypeScript engine.

Generates NDJSON (one JSON object per line) rather than one giant JSON array,
so both this script and the Node/vitest consumer can stream instead of
holding the whole set in memory, and so a partial/truncated run is still
readable up to its last complete line.

Each output line is: {"id": <str>, "category": <str>, "input": {...}, "expected": {...} | {"rejected": <reason>}}

Usage: python3 generate_fuzz_fixtures.py <out_dir> [--seed N]
"""
from __future__ import annotations
import argparse
import json
import random
import sys
from fractions import Fraction as D
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import numerical_oracle as ora

PAINT_VARIANTS = ["v-alpha", "v-beta", "v-gamma"]


def dstr(x) -> str:
    """Serialize an oracle value (or None) for JSON transport, as the
    MINIMAL exact decimal string that reparses to the identical value --
    used for INPUT fields a test harness will reconstruct via `new
    PEP(str)`, where trailing-zero style doesn't matter. Never use this for
    an "expected" OUTPUT field that gets compared byte-for-byte against
    production's `.toFixed(n)` -- use `estr` for those."""
    if x is None:
        return None
    return ora.to_minimal_string(x)


def estr(x, places: int = 2):
    """Serialize an already-rounded (half_up/money'd) oracle OUTPUT value as
    a FIXED-width decimal string with exactly `places` digits, matching
    what production's `.toFixed(places)` produces -- e.g. money(2623) must
    serialize as "2623.00", not "2623". Passing through None is allowed."""
    if x is None:
        return None
    return ora.to_fixed_string(x, places)


def rand_decimal(rng: random.Random, lo: str, hi: str, max_places: int = 4, min_places: int = 0) -> D:
    """min_places > 0 must be used for any field with a sub-1 span (ratios
    like waste/overhead/target-margin) -- places=0 means 'round to the
    nearest whole INTEGER', which for a [0, 0.6] ratio can push the result
    to exactly 1, silently violating that field's own valid range."""
    lo_d, hi_d = D(lo), D(hi)
    span = hi_d - lo_d
    frac = D(rng.random()).limit_denominator(10 ** 10)
    raw = lo_d + span * frac
    places = rng.randint(min_places, max_places)
    return ora.half_up(raw, places)


def gen_surface(rng: random.Random, idx: int, variant: str) -> ora.SurfaceInput:
    kind = rng.choice(["wall", "ceiling", "trim", "door"])
    coats = rng.randint(1, 5)
    waste = rand_decimal(rng, "0", "0.5", 2, min_places=1)
    rate = rand_decimal(rng, "0.5", "500", 2)
    hourly_rate = rand_decimal(rng, "10", "150", 2)
    if kind in ("wall", "ceiling"):
        return ora.SurfaceInput(id=f"s{idx}", enabled=True, kind=kind, paint_variant_id=variant,
                                 coats=coats, waste_ratio=waste, loaded_hourly_rate=hourly_rate,
                                 rate_or_throughput=rate, area_ft2=rand_decimal(rng, "1", "2000", 2))
    if kind == "trim":
        return ora.SurfaceInput(id=f"s{idx}", enabled=True, kind="trim", paint_variant_id=variant,
                                 coats=coats, waste_ratio=waste, loaded_hourly_rate=hourly_rate,
                                 rate_or_throughput=rate, trim_length_ft=rand_decimal(rng, "1", "500", 2),
                                 developed_width_ft=rand_decimal(rng, "0.1", "2", 2))
    # door
    return ora.SurfaceInput(id=f"s{idx}", enabled=True, kind="door", paint_variant_id=variant,
                             coats=coats, waste_ratio=waste, loaded_hourly_rate=hourly_rate,
                             rate_or_throughput=rand_decimal(rng, "0.1", "3", 2),
                             door_count=rng.randint(1, 20), door_width_ft=rand_decimal(rng, "1.5", "4", 2),
                             door_height_ft=rand_decimal(rng, "6", "9", 2), painted_sides=rng.choice([1, 2]))


def surface_to_json(s: ora.SurfaceInput) -> dict:
    return {
        "id": s.id, "enabled": s.enabled, "valid": s.valid, "kind": s.kind, "paintVariantId": s.paint_variant_id,
        "coats": s.coats, "wasteRatio": dstr(s.waste_ratio), "loadedHourlyRate": dstr(s.loaded_hourly_rate),
        "rateOrThroughput": dstr(s.rate_or_throughput),
        "areaFt2": dstr(s.area_ft2), "trimLengthFt": dstr(s.trim_length_ft),
        "developedWidthFt": dstr(s.developed_width_ft), "doorCount": s.door_count,
        "doorWidthFt": dstr(s.door_width_ft), "doorHeightFt": dstr(s.door_height_ft),
        "paintedSides": s.painted_sides,
    }


def gen_valid_project(rng: random.Random, idx: int) -> dict:
    n_surfaces = rng.randint(1, 4)
    variants = rng.sample(PAINT_VARIANTS, k=min(rng.randint(1, 2), len(PAINT_VARIANTS)))
    surfaces = [gen_surface(rng, i, rng.choice(variants)) for i in range(n_surfaces)]
    variant_pricing = {v: ora.VariantPricing(coverage_per_gal=rand_decimal(rng, "250", "450", 0),
                                              price_per_gal=rand_decimal(rng, "15", "80", 2)) for v in variants}

    n_add_labor = rng.randint(0, 2)
    add_labor = [(rand_decimal(rng, "0", "20", 2), rand_decimal(rng, "10", "100", 2)) for _ in range(n_add_labor)]
    n_other_mat = rng.randint(0, 2)
    other_mat = [(rand_decimal(rng, "0", "50", 2), rand_decimal(rng, "0", "200", 2)) for _ in range(n_other_mat)]

    supplies_mode = rng.choice(["none", "flat", "paintPercent"])
    supplies_flat = rand_decimal(rng, "0", "300", 2) if supplies_mode == "flat" else None
    supplies_pct = rand_decimal(rng, "0", "0.2", 3, min_places=1) if supplies_mode == "paintPercent" else None

    n_expenses = rng.randint(0, 2)
    expenses = [rand_decimal(rng, "0", "200", 2) for _ in range(n_expenses)]

    overhead_ratio = rand_decimal(rng, "0", "0.5", 3, min_places=1)
    target_margin = rand_decimal(rng, "0", "0.6", 3, min_places=1)

    price_choice = rng.choice(["none", "zero", "value"])
    if price_choice == "none":
        price = None
    elif price_choice == "zero":
        price = D("0")
    else:
        price = rand_decimal(rng, "1", "50000", 2)

    result = ora.assemble_project_estimate(
        surfaces=surfaces, variant_pricing=variant_pricing,
        additional_labor_lines=add_labor, other_material_lines=other_mat,
        supplies_mode=supplies_mode, supplies_flat_amount=supplies_flat,
        supplies_paint_percent_ratio=supplies_pct, other_expense_amounts=expenses,
        overhead_ratio=overhead_ratio, target_margin_ratio=target_margin, price=price,
    )

    input_json = {
        "surfaces": [surface_to_json(s) for s in surfaces],
        "variantPricing": {v: {"coveragePerGal": dstr(p.coverage_per_gal), "pricePerGal": dstr(p.price_per_gal)}
                            for v, p in variant_pricing.items()},
        "additionalLaborLines": [{"hours": dstr(h), "loadedHourlyRate": dstr(r)} for h, r in add_labor],
        "otherMaterialLines": [{"quantity": dstr(q), "unitCost": dstr(u)} for q, u in other_mat],
        "suppliesMode": supplies_mode, "suppliesFlatAmount": dstr(supplies_flat), "suppliesPaintPercentRatio": dstr(supplies_pct),
        "otherExpenseAmounts": [dstr(e) for e in expenses],
        "overheadRatio": dstr(overhead_ratio), "targetMarginRatio": dstr(target_margin),
        "price": dstr(price),
    }

    if not result.valid:
        expected = {"valid": False}
    else:
        pr = result.price_result
        expected = {
            "valid": True,
            "materialsCost": estr(ora.money(result.materials_cost)),
            "laborCost": estr(ora.money(result.labor_cost)),
            "directCost": estr(ora.money(result.direct_cost)),
            "overhead": estr(ora.money(result.overhead)),
            "jobCost": estr(ora.money(result.job_cost)),
            "profit": estr(ora.money(pr.profit)) if pr.profit is not None else None,
            "marginRatio": estr(ora.half_up(pr.margin_ratio, 10), 10) if pr.margin_ratio is not None else None,
            "status": pr.status,
            "approxPrice": estr(pr.approx_price),
            "minimumTargetPrice": estr(pr.minimum_target_price),
        }

    return {"id": f"proj-{idx}", "category": "valid_project", "input": input_json, "expected": expected}


def gen_incomplete_project(rng: random.Random, idx: int) -> dict:
    """A project missing a required field (e.g. no enabled surfaces) --
    production must report 'incomplete', never a fabricated total."""
    return {"id": f"incomplete-{idx}", "category": "incomplete", "input": {"surfaces": [], "note": "zero enabled surfaces"},
            "expected": {"valid": False}}


def gen_invalid_project(rng: random.Random, idx: int) -> dict:
    """A project with an enabled-but-geometrically-invalid surface (opening
    deduction exceeds gross area) -- must block the whole project."""
    variant = "v-alpha"
    bad = ora.SurfaceInput(id="bad", enabled=True, valid=False, kind="wall", paint_variant_id=variant,
                            coats=2, waste_ratio=D("0.1"), loaded_hourly_rate=D("30"),
                            rate_or_throughput=D("150"), area_ft2=D("50"))
    good = gen_surface(rng, 0, variant)
    variant_pricing = {variant: ora.VariantPricing(coverage_per_gal=D("350"), price_per_gal=D("40"))}
    result = ora.assemble_project_estimate(
        surfaces=[good, bad], variant_pricing=variant_pricing, additional_labor_lines=[], other_material_lines=[],
        supplies_mode="none", supplies_flat_amount=None, supplies_paint_percent_ratio=None,
        other_expense_amounts=[], overhead_ratio=D("0.15"), target_margin_ratio=D("0.35"), price=None,
    )
    assert result.valid is False
    return {"id": f"invalid-{idx}", "category": "invalid",
            "input": {"surfaces": [surface_to_json(good), surface_to_json(bad)],
                       "variantPricing": {variant: {"coveragePerGal": "350", "pricePerGal": "40"}},
                       "additionalLaborLines": [], "otherMaterialLines": [], "suppliesMode": "none",
                       "suppliesFlatAmount": None, "suppliesPaintPercentRatio": None, "otherExpenseAmounts": [],
                       "overheadRatio": "0.15", "targetMarginRatio": "0.35", "price": None},
            "expected": {"valid": False}}


def gen_boundary_adjacent_project(rng: random.Random, idx: int) -> dict:
    """A project whose paint demand sits exactly at, just below, or just
    above a purchase-increment boundary (1 gallon) -- exercises the
    ceiling-purchase exactness rule with no epsilon slop."""
    variant = "v-alpha"
    coverage = D("350")
    # choose an area so raw demand lands near an integer number of gallons
    target_gal = rng.choice([D("1"), D("2"), D("3")])
    offset = rng.choice([D("-0.0001"), D("0"), D("0.0001")])
    raw_target = target_gal + offset
    # raw = area*coats*(1+waste)/coverage => area = raw*coverage/(coats*(1+waste))
    coats = 1
    waste = D("0")
    area = raw_target * coverage / (D(coats) * (D(1) + waste))
    surf = ora.SurfaceInput(id="s0", enabled=True, kind="wall", paint_variant_id=variant, coats=coats,
                             waste_ratio=waste, loaded_hourly_rate=D("30"), rate_or_throughput=D("150"),
                             area_ft2=ora.half_up(area, 6))
    variant_pricing = {variant: ora.VariantPricing(coverage_per_gal=coverage, price_per_gal=D("40"))}
    result = ora.assemble_project_estimate(
        surfaces=[surf], variant_pricing=variant_pricing, additional_labor_lines=[], other_material_lines=[],
        supplies_mode="none", supplies_flat_amount=None, supplies_paint_percent_ratio=None,
        other_expense_amounts=[], overhead_ratio=D("0"), target_margin_ratio=D("0.35"), price=None,
    )
    pr = result.price_result
    return {"id": f"boundary-{idx}", "category": "boundary_adjacent",
            "input": {"surfaces": [surface_to_json(surf)],
                       "variantPricing": {variant: {"coveragePerGal": dstr(coverage), "pricePerGal": "40"}},
                       "additionalLaborLines": [], "otherMaterialLines": [], "suppliesMode": "none",
                       "suppliesFlatAmount": None, "suppliesPaintPercentRatio": None, "otherExpenseAmounts": [],
                       "overheadRatio": "0", "targetMarginRatio": "0.35", "price": None},
            "expected": {"valid": True, "materialsCost": estr(ora.money(result.materials_cost)),
                         "laborCost": estr(ora.money(result.labor_cost)), "directCost": estr(ora.money(result.direct_cost)),
                         "overhead": estr(ora.money(result.overhead)), "jobCost": estr(ora.money(result.job_cost)),
                         "profit": None, "marginRatio": None, "status": pr.status,
                         "approxPrice": estr(pr.approx_price), "minimumTargetPrice": estr(pr.minimum_target_price)}}


def gen_loss_project(rng: random.Random, idx: int) -> dict:
    """price explicitly below cost, at zero, or unpriced -- exercising the
    below_cost / zero_price / unpriced states and their signed-profit math."""
    variant = "v-alpha"
    surf = gen_surface(rng, 0, variant)
    variant_pricing = {variant: ora.VariantPricing(coverage_per_gal=D("350"), price_per_gal=rand_decimal(rng, "15", "80", 2))}
    price_choice = rng.choice(["zero", "below_cost", "unpriced"])
    add_labor = [(rand_decimal(rng, "1", "10", 2), rand_decimal(rng, "20", "80", 2))]
    result_probe = ora.assemble_project_estimate(
        surfaces=[surf], variant_pricing=variant_pricing, additional_labor_lines=add_labor, other_material_lines=[],
        supplies_mode="none", supplies_flat_amount=None, supplies_paint_percent_ratio=None,
        other_expense_amounts=[], overhead_ratio=D("0.15"), target_margin_ratio=D("0.35"), price=None,
    )
    if not result_probe.valid:
        price = None
    elif price_choice == "zero":
        price = D("0")
    elif price_choice == "unpriced":
        price = None
    else:
        price = ora.money(result_probe.job_cost * D("0.5"))  # deliberately below cost

    result = ora.assemble_project_estimate(
        surfaces=[surf], variant_pricing=variant_pricing, additional_labor_lines=add_labor, other_material_lines=[],
        supplies_mode="none", supplies_flat_amount=None, supplies_paint_percent_ratio=None,
        other_expense_amounts=[], overhead_ratio=D("0.15"), target_margin_ratio=D("0.35"), price=price,
    )
    input_json = {"surfaces": [surface_to_json(surf)],
                  "variantPricing": {variant: {"coveragePerGal": "350", "pricePerGal": dstr(variant_pricing[variant].price_per_gal)}},
                  "additionalLaborLines": [{"hours": dstr(h), "loadedHourlyRate": dstr(r)} for h, r in add_labor],
                  "otherMaterialLines": [], "suppliesMode": "none", "suppliesFlatAmount": None,
                  "suppliesPaintPercentRatio": None, "otherExpenseAmounts": [], "overheadRatio": "0.15",
                  "targetMarginRatio": "0.35", "price": dstr(price)}
    if not result.valid:
        expected = {"valid": False}
    else:
        pr = result.price_result
        expected = {"valid": True, "materialsCost": estr(ora.money(result.materials_cost)),
                    "laborCost": estr(ora.money(result.labor_cost)), "directCost": estr(ora.money(result.direct_cost)),
                    "overhead": estr(ora.money(result.overhead)), "jobCost": estr(ora.money(result.job_cost)),
                    "profit": estr(ora.money(pr.profit)) if pr.profit is not None else None,
                    "marginRatio": estr(ora.half_up(pr.margin_ratio, 10), 10) if pr.margin_ratio is not None else None,
                    "status": pr.status, "approxPrice": estr(pr.approx_price), "minimumTargetPrice": estr(pr.minimum_target_price)}
    return {"id": f"loss-{idx}", "category": "loss_zero_unpriced", "input": input_json, "expected": expected}


def gen_service_health(rng: random.Random, idx: int) -> dict:
    kind = rng.choice(["wall", "ceiling", "trim", "door"])
    coats = rng.randint(1, 5)
    waste = rand_decimal(rng, "0", "0.5", 2, min_places=1)
    coverage = rand_decimal(rng, "250", "450", 0)
    price_per_gal = rand_decimal(rng, "15", "80", 2)
    area_per_unit = rand_decimal(rng, "0.1", "50", 4)
    app_hours = rand_decimal(rng, "0.001", "5", 6)
    additional_hours = rand_decimal(rng, "0", "2", 4)
    hourly_rate = rand_decimal(rng, "10", "150", 2)
    supplies_per_unit = rand_decimal(rng, "0", "5", 4)
    expense_per_unit = rand_decimal(rng, "0", "5", 4)
    overhead_ratio = rand_decimal(rng, "0", "0.5", 3, min_places=1)
    target_margin = rand_decimal(rng, "0", "0.6", 3, min_places=1)
    selling_price = rng.choice([None, D("0"), rand_decimal(rng, "0.5", "500", 2)])

    unit = ora.compute_service_unit_cost(kind, area_per_unit, coats, waste, coverage, price_per_gal,
                                          app_hours, additional_hours, hourly_rate,
                                          supplies_per_unit, expense_per_unit, overhead_ratio)
    pr = ora.evaluate_service_health(unit, selling_price, target_margin)

    return {"id": f"pbh-{idx}", "category": "price_book_health",
            "input": {"kind": kind, "areaOrLengthPerUnit": dstr(area_per_unit), "coats": coats,
                       "wasteRatio": dstr(waste), "coverage": dstr(coverage), "pricePerGal": dstr(price_per_gal),
                       "applicationHoursPerUnit": dstr(app_hours), "additionalLaborHoursPerUnit": dstr(additional_hours),
                       "loadedHourlyRate": dstr(hourly_rate), "suppliesCostPerUnit": dstr(supplies_per_unit),
                       "directExpensePerUnit": dstr(expense_per_unit),
                       "overheadRatio": dstr(overhead_ratio), "targetMarginRatio": dstr(target_margin),
                       "currentSellingPrice": dstr(selling_price)},
            "expected": {"paintConsumptionCostPerUnit": estr(ora.half_up(unit.paint_consumption_cost_per_unit, 8), 8),
                          "materialsPerUnit": estr(ora.half_up(unit.materials_per_unit, 8), 8),
                          "laborCostPerUnit": estr(ora.half_up(unit.labor_cost_per_unit, 8), 8),
                          "directCostPerUnit": estr(ora.half_up(unit.direct_cost_per_unit, 8), 8),
                          "overheadPerUnit": estr(ora.half_up(unit.overhead_per_unit, 8), 8),
                          "modeledCostPerUnit": estr(ora.half_up(unit.modeled_cost_per_unit, 8), 8),
                          "status": pr.status,
                          "profit": estr(ora.money(pr.profit)) if pr.profit is not None else None,
                          "marginRatio": estr(ora.half_up(pr.margin_ratio, 10), 10) if pr.margin_ratio is not None else None}}


def gen_actual_category(rng: random.Random, lo: str, hi: str, allow_unconfirmed: bool) -> tuple[ora.ActualCategory, dict]:
    """Returns (oracle category, json-serializable form). ~15% chance of an
    unconfirmed or blank-but-confirmed category when allow_unconfirmed, to
    exercise the in_progress / partial-actuals state space, not just the
    all-four-confirmed path."""
    if allow_unconfirmed and rng.random() < 0.15:
        # unconfirmed, or confirmed-but-still-blank (amount None) -- both
        # must be treated identically by evaluateActualReview (categoryValue).
        confirmed = rng.choice([True, False])
        return ora.ActualCategory(confirmed=confirmed, amount=None), {"confirmed": confirmed, "amount": None}
    amount = rand_decimal(rng, lo, hi, 2)
    return ora.ActualCategory(confirmed=True, amount=amount), {"confirmed": True, "amount": dstr(amount)}


def gen_actual_cost(rng: random.Random, idx: int) -> dict:
    # ~30% of fixtures deliberately exercise partial/in-progress actuals;
    # the rest are (usually) fully confirmed, occasionally landing on the
    # out-of-supported-range aggregate boundary via a wide amount range.
    allow_unconfirmed = rng.random() < 0.3
    wide_range = rng.random() < 0.02  # rare: pushes toward the 1e9 aggregate ceiling
    hi = "999999999" if wide_range else "5000"

    materials_cat, materials_json = gen_actual_category(rng, "0", hi, allow_unconfirmed)
    labor_cat, labor_json = gen_actual_category(rng, "0", hi, allow_unconfirmed)
    expenses_cat, expenses_json = gen_actual_category(rng, "0", "1000" if not wide_range else hi, allow_unconfirmed)
    overhead_cat, overhead_json = gen_actual_category(rng, "0", "1000" if not wide_range else hi, allow_unconfirmed)

    baseline_price = rng.choice([D("0"), rand_decimal(rng, "1", "20000", 2)])
    baseline_cost = rand_decimal(rng, "0", "15000", 2)

    r = ora.evaluate_actual_review(materials_cat, labor_cat, expenses_cat, overhead_cat, baseline_price, baseline_cost)

    input_json = {"materials": materials_json, "labor": labor_json, "otherExpenses": expenses_json,
                   "overhead": overhead_json, "baselinePrice": dstr(baseline_price), "baselineCost": dstr(baseline_cost)}

    if r.state != "final":
        expected = {"state": r.state, "confirmedCategories": r.confirmed_categories,
                    "recordedCostSoFar": estr(ora.money(r.recorded_cost_so_far))}
    else:
        expected = {"state": r.state, "confirmedCategories": r.confirmed_categories,
                    "recordedCostSoFar": estr(ora.money(r.recorded_cost_so_far)),
                    "actualCost": estr(ora.money(r.actual_total)),
                    "profitAgainstOriginalQuote": estr(ora.money(r.profit_vs_original)),
                    "marginRatio": estr(ora.half_up(r.actual_margin, 10), 10) if r.actual_margin is not None else None,
                    "totalVariance": estr(ora.money(r.variance))}

    return {"id": f"actual-{idx}", "category": "actual_cost", "input": input_json, "expected": expected}


CATEGORY_GENERATORS = {
    "valid_project": gen_valid_project,
    "incomplete": gen_incomplete_project,
    "invalid": gen_invalid_project,
    "boundary_adjacent": gen_boundary_adjacent_project,
    "loss_zero_unpriced": gen_loss_project,
    "price_book_health": gen_service_health,
    "actual_cost": gen_actual_cost,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--seed", type=int, default=20260916)
    ap.add_argument("--counts", type=str, default="valid_project=100000,incomplete=25000,invalid=25000,boundary_adjacent=25000,loss_zero_unpriced=10000,price_book_health=10000,actual_cost=10000")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    counts = {}
    for part in args.counts.split(","):
        k, v = part.split("=")
        counts[k] = int(v)

    manifest = {"seed": args.seed, "counts": counts, "total": sum(counts.values())}

    for category, count in counts.items():
        gen = CATEGORY_GENERATORS[category]
        rng = random.Random(f"{args.seed}:{category}")
        out_path = out_dir / f"{category}.ndjson"
        with out_path.open("w", encoding="utf-8") as f:
            for i in range(count):
                fixture = gen(rng, i)
                f.write(json.dumps(fixture) + "\n")
        print(f"wrote {count} fixtures -> {out_path}")

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"manifest: {json.dumps(manifest)}")


if __name__ == "__main__":
    main()
