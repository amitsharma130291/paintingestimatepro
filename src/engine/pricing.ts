import { PEP, ceilDecimal, halfUp, type Dec } from './decimal';
import { MAX_REQUIRED_PRICE } from './parse';
import type { PriceResult, PriceStatus } from './types';

/**
 * CALCULATION_SPEC.md §6 — Price, profit, and margin. This is THE most
 * safety-critical module: margin is never markup, a null price and a zero
 * price are different states, negative profit/margin are never clamped,
 * and the suggested price is the *minimum* cent that meets the target
 * (never the nearest-cent approximation, which can silently undershoot).
 */

export function requiredPriceRaw(cost: Dec, targetMarginRatio: Dec): Dec | 'out_of_supported_range' {
  // targetMarginRatio must be 0 <= m < 1 (validated upstream); guard here too.
  if (targetMarginRatio.greaterThanOrEqualTo(1) || targetMarginRatio.lessThan(0)) {
    // Stryker disable next-line StringLiteral: message prose only — this is
    // an unreachable-in-production defensive guard (targetMarginRatio is
    // validated upstream by the domain layer before ever reaching this
    // function); no caller inspects the message text, only that it throws.
    throw new Error('targetMarginRatio out of range; validate before calling requiredPriceRaw');
  }
  const raw = cost.dividedBy(new PEP(1).minus(targetMarginRatio));
  if (raw.greaterThan(MAX_REQUIRED_PRICE)) return 'out_of_supported_range';
  return raw;
}

export function approxPrice(raw: Dec): Dec {
  return halfUp(raw, 2);
}

/** The minimum cent value that is >= raw — guarantees margin(price) >=
 * target, unlike nearest-cent rounding which can round down. */
export function minimumTargetPrice(raw: Dec): Dec {
  return ceilDecimal(raw.times(100)).dividedBy(100);
}

export function margin(price: Dec, cost: Dec): Dec | null {
  if (!price.greaterThan(0)) return null; // null, not 0 — "undefined", not "no margin"
  return price.minus(cost).dividedBy(price);
}

export function markup(price: Dec, cost: Dec): Dec | null {
  if (!cost.greaterThan(0)) return null;
  return price.minus(cost).dividedBy(cost);
}

export interface EvaluatePriceInput {
  cost: Dec;
  price: Dec | null; // null = not entered ("unpriced"); explicit 0 = "zero_price"
  targetMarginRatio: Dec;
}

export function evaluatePrice(input: EvaluatePriceInput): PriceResult {
  const { cost, price, targetMarginRatio } = input;
  const raw = requiredPriceRaw(cost, targetMarginRatio);
  const approx = raw === 'out_of_supported_range' ? null : approxPrice(raw);
  const minTarget = raw === 'out_of_supported_range' ? null : minimumTargetPrice(raw);

  if (price === null) {
    return { profit: null, marginRatio: null, status: 'unpriced', approxPrice: approx, minimumTargetPrice: minTarget };
  }

  if (price.isZero()) {
    // CALCULATION_SPEC §6: "Explicit price=0: profit=-cost, margin=null,
    // status=zero_price" — profit is NOT null here, only margin is.
    return {
      profit: cost.negated(),
      marginRatio: null,
      status: 'zero_price',
      approxPrice: approx,
      minimumTargetPrice: minTarget,
    };
  }

  const profit = price.minus(cost);
  const marginRatio = margin(price, cost);
  const status: PriceStatus =
    profit.isNegative()
      ? 'below_cost'
      : marginRatio!.lessThan(targetMarginRatio)
        ? 'below_target'
        : marginRatio!.equals(targetMarginRatio)
          ? 'at_target'
          : 'above_target';

  return { profit, marginRatio, status, approxPrice: approx, minimumTargetPrice: minTarget };
}
