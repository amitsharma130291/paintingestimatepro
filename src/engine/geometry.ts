import { PEP, type Dec } from './decimal';

/** CALCULATION_SPEC.md §3 — Geometry. */

export function grossWallArea(lengthFt: Dec, widthFt: Dec, heightFt: Dec): Dec {
  return lengthFt.plus(widthFt).times(2).times(heightFt);
}

export function ceilingArea(lengthFt: Dec, widthFt: Dec): Dec {
  return lengthFt.times(widthFt);
}

export function quickOpeningArea(doorCount: number, doorAreaEach: Dec, windowCount: number, windowAreaEach: Dec): Dec {
  return doorAreaEach.times(doorCount).plus(windowAreaEach.times(windowCount));
}

export function detailedOpeningArea(openings: { widthFt: Dec; heightFt: Dec; count: number }[]): Dec {
  return openings.reduce((sum, o) => sum.plus(o.widthFt.times(o.heightFt).times(o.count)), new PEP(0));
}

export interface NetWallAreaResult {
  /** The raw (possibly negative) gross-minus-opening value — for a
   * display-only clamped preview ONLY when `valid` is false. Never feed
   * this into a downstream calculation when `valid` is false. */
  area: Dec;
  valid: boolean;
}

/** "If opening area > gross, return invalid; a display-only preview can
 * clamp to zero but final calculation remains blocked." (§3) */
export function netWallArea(gross: Dec, openingArea: Dec, deductionEnabled: boolean): NetWallAreaResult {
  if (!deductionEnabled) return { area: gross, valid: true };
  const area = gross.minus(openingArea);
  return { area, valid: !openingArea.greaterThan(gross) };
}

export function clampForPreview(area: Dec): Dec {
  return Dec_max(area, new PEP(0));
}

function Dec_max(a: Dec, b: Dec): Dec {
  return a.greaterThan(b) ? a : b;
}

export function trimPaintableArea(trimLengthFt: Dec, developedWidthFt: Dec): Dec {
  return trimLengthFt.times(developedWidthFt);
}

export function doorPaintableArea(count: number, widthFt: Dec, heightFt: Dec, paintedSides: 1 | 2): Dec {
  return widthFt.times(heightFt).times(count).times(paintedSides);
}
