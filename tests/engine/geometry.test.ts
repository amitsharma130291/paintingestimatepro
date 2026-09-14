// GEO: geometry formulas and the "openings exceed gross wall -> invalid,
// not a valid zero-area room" rule (CALCULATION_SPEC §3, V05).
import { describe, it, expect } from 'vitest';
import { PEP } from '../../src/engine/decimal';
import {
  grossWallArea,
  ceilingArea,
  quickOpeningArea,
  detailedOpeningArea,
  netWallArea,
  clampForPreview,
  trimPaintableArea,
  doorPaintableArea,
} from '../../src/engine/geometry';

const d = (n: string) => new PEP(n);

describe('GEO: room and surface geometry', () => {
  it('GEO-01: rectangular gross wall area', () => {
    expect(grossWallArea(d('20'), d('16'), d('9')).toNumber()).toBe(648);
  });

  it('GEO-02: ceiling area', () => {
    expect(ceilingArea(d('20'), d('16')).toNumber()).toBe(320);
  });

  it('GEO-03: quick opening area uses exact 20/15 defaults from the brief', () => {
    expect(quickOpeningArea(2, d('20'), 3, d('15')).toNumber()).toBe(85);
  });

  it('GEO-04: detailed opening area sums width*height*count, and 3x6.67 != 20', () => {
    const area = detailedOpeningArea([{ widthFt: d('3'), heightFt: d('6.67'), count: 1 }]);
    expect(area.toNumber()).toBeCloseTo(20.01, 5);
    expect(area.equals(20)).toBe(false); // quick (20) and detailed (20.01) must never be forced equal
  });

  it('GEO-05: net wall area = gross - openings when deduction enabled', () => {
    const r = netWallArea(d('648'), d('85'), true);
    expect(r.valid).toBe(true);
    expect(r.area.toNumber()).toBe(563);
  });

  it('GEO-06: deduction disabled ignores opening entries entirely', () => {
    const r = netWallArea(d('648'), d('85'), false);
    expect(r.valid).toBe(true);
    expect(r.area.toNumber()).toBe(648);
  });

  it('GEO-07 (V05): openings exceeding gross wall area -> invalid, not a valid zero/negative room', () => {
    const r = netWallArea(d('100'), d('150'), true);
    expect(r.valid).toBe(false); // final calculation MUST be blocked upstream when this is false
    expect(r.area.isNegative()).toBe(true); // raw value only, for a display-only clamp
    expect(clampForPreview(r.area).toNumber()).toBe(0); // preview may clamp; final calc must not use it
  });

  it('GEO-08: opening area exactly equal to gross wall area -> valid zero net area', () => {
    const r = netWallArea(d('100'), d('100'), true);
    expect(r.valid).toBe(true);
    expect(r.area.toNumber()).toBe(0);
  });

  it('GEO-09: trim paintable area = length * developed width, not treated as square feet of a face alone', () => {
    expect(trimPaintableArea(d('100'), d('0.5')).toNumber()).toBe(50);
  });

  it('GEO-10: door paintable area scales with painted sides', () => {
    expect(doorPaintableArea(1, d('3'), d('7'), 1).toNumber()).toBe(21);
    expect(doorPaintableArea(1, d('3'), d('7'), 2).toNumber()).toBe(42);
  });

  it('GEO-11: doors of different dimensions/sides must be modeled as separate surfaces (no implicit averaging)', () => {
    const doorA = doorPaintableArea(1, d('3'), d('7'), 1);
    const doorB = doorPaintableArea(1, d('2.5'), d('6.5'), 2);
    expect(doorA.toNumber()).not.toBe(doorB.toNumber());
  });
});
