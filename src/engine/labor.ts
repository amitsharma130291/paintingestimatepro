import { PEP, type Dec } from './decimal';

/** CALCULATION_SPEC.md §5 — production hours by surface kind. Each surface
 * type uses its OWN correct unit — trim labor scales with linear length
 * (time to move along the run), not the developed-width area; door labor
 * uses a fixed per-side-per-coat allowance, not an area/throughput rate. */

export function wallOrCeilingHours(netAreaFt2: Dec, coats: number, throughputFt2PerHourPerCoat: Dec): Dec {
  return netAreaFt2.times(coats).dividedBy(throughputFt2PerHourPerCoat);
}

export function trimHours(trimLengthFt: Dec, coats: number, throughputLinearFtPerHourPerCoat: Dec): Dec {
  return trimLengthFt.times(coats).dividedBy(throughputLinearFtPerHourPerCoat);
}

export function doorHours(count: number, paintedSides: 1 | 2, coats: number, hoursPerSidePerCoat: Dec): Dec {
  return hoursPerSidePerCoat.times(count).times(paintedSides).times(coats);
}

export interface AdditionalLaborLine {
  hours: Dec;
  loadedHourlyRate: Dec;
}

export function additionalLaborCost(lines: AdditionalLaborLine[]): Dec {
  return lines.reduce((sum, l) => sum.plus(l.hours.times(l.loadedHourlyRate)), new PEP(0));
}

export interface SurfaceLaborLine {
  hours: Dec;
  loadedHourlyRate: Dec;
}

export function surfaceApplicationLaborCost(lines: SurfaceLaborLine[]): Dec {
  return lines.reduce((sum, l) => sum.plus(l.hours.times(l.loadedHourlyRate)), new PEP(0));
}
